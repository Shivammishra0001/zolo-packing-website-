"""Billing Accuracy.

Rules first, model second, and the model never touches a number.

Everything this agent finds is found by arithmetic on ``Decimal`` values read
out of PostgreSQL: line amounts against quantity times rate, the invoice total
against its components, settled payments against the stated status, and
services delivered inside the invoice's window against the lines that were
raised for them. A language model is asked, afterwards, to put the findings in
a sentence — and if there is no model, the findings are identical.

The agent has no write path. It cannot adjust a line, raise a total or change a
status, and the endpoint that calls it is a GET-shaped check rather than a
correction. An assistant that could quietly increase a patient's bill would be
a billing system with an unaccountable actor in it.

Results come back in **two lists, and the split is the point**:

* ``systemErrors`` — the stored figures contradict the stored lines. Quantity
  times rate is not the line amount; the lines do not add to the subtotal; the
  invoice says paid and the payments say otherwise. These are defects in the
  data, established by arithmetic, and calling one an "AI finding" would invite
  somebody to weigh it against a suggestion and decide it was probably fine.
* ``findings`` — heuristics. "Eight therapy sessions exist and the invoice
  seems to charge for five." A person decides.

``notAssessed`` names what the check deliberately did not judge, because a
clean result that quietly skipped half the question is worse than a noisy one.
"""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

from sqlalchemy.orm import Session

from app.ai import retrieval
from app.ai.orchestrator import Orchestrator
from app.ai.prompts import billing as prompt
from app.ai.schemas import BillingCheckResponse, BillingFinding, FinanceNarrative
from sqlalchemy import select

from app.core.enums import AIAgentType, InvoiceDepartment, InvoiceStatus
from app.models.billing import Invoice, InvoiceItem
from app.models.user import User

#: Checking an invoice needs the permission that reading invoices needs.
PERMISSION = "billing.view"

#: Rounding tolerance. Amounts are NUMERIC(12,2), so anything above a paisa is
#: a real discrepancy rather than a floating-point artefact.
TOLERANCE = Decimal("0.01")

#: How far back an invoice is assumed to bill for. A clinic raises invoices
#: within a month of the work; looking further would flag every service the
#: patient ever had as missing from every invoice they ever received.
WINDOW_DAYS = 30

#: Which delivered service belongs on which department's invoice. A therapy
#: session missing from an OPD invoice is not a finding — it is a different
#: invoice.
_DEPARTMENT_ACTIVITY: dict[InvoiceDepartment, str] = {
    InvoiceDepartment.OPD: "consultation",
    InvoiceDepartment.THERAPY: "therapy",
    InvoiceDepartment.DIAGNOSTICS: "lab",
}

#: Concepts this application does not model, and therefore cannot rule out as
#: explanations for an apparently unbilled service. Returned with every check
#: that runs the unbilled rule, because a finding a clerk cannot evaluate
#: without this context is a finding they will learn to dismiss.
#:
#: These are limitations, not business rules invented to make the check look
#: complete. When the billing module grows a concept of a package or a written
#: -off charge, the corresponding line comes off this list and becomes a real
#: exclusion.
UNMODELLED_CONCEPTS = (
    "Services provided free of charge are not modelled, so a deliberately "
    "unbilled service cannot be distinguished from a missed one.",
    "Bundles and packages are not modelled: several sessions covered by one "
    "line will look like several unbilled sessions.",
    "Insurance coverage is not modelled, so a claim-covered service is not "
    "excluded.",
)

#: Words that make a line plausibly the bill for a delivered service.
_ACTIVITY_KEYWORDS: dict[str, tuple[str, ...]] = {
    "consultation": ("consult", "opd", "visit", "review"),
    "therapy": ("therapy", "session", "physio", "rehab"),
    "lab": ("lab", "test", "panel", "profile", "investigation"),
}


def check(
    db: Session,
    *,
    invoice: Invoice,
    user: User,
    request_id: str,
) -> BillingCheckResponse:
    lines = retrieval.invoice_lines(db, invoice_id=invoice.id)
    paid = retrieval.settled_total(db, invoice_id=invoice.id)

    recomputed = _recompute(lines, invoice)

    # Arithmetic first, and kept apart. These are established facts about the
    # stored rows; everything below them is a question.
    system_errors: list[BillingFinding] = []
    system_errors += _line_arithmetic(lines)
    system_errors += _totals(invoice, recomputed)
    system_errors += _payments(invoice, paid)

    findings: list[BillingFinding] = []
    findings += _zero_rated(lines)
    findings += _duplicates(lines)
    unbilled, not_assessed = _unbilled(db, invoice=invoice, lines=lines)
    findings += unbilled

    stored = {
        "subtotal": Decimal(invoice.subtotal),
        "discount": Decimal(invoice.discount),
        "tax": Decimal(invoice.tax),
        "total": Decimal(invoice.total),
        "paid": paid,
        "balance": Decimal(invoice.total) - paid,
    }

    orchestrator = Orchestrator(
        db=db,
        user=user,
        request_id=request_id,
        agent=AIAgentType.BILLING_ACCURACY,
        entity_type="invoices",
        entity_id=invoice.id,
    )
    orchestrator.enforce_rate_limit()

    narrative, outcome = orchestrator.structured(
        system=prompt.SYSTEM,
        task=prompt.TASK,
        data=prompt.data(
            invoice={
                "number": invoice.invoice_number,
                "department": invoice.department.display,
                "status": invoice.status.display,
                **{k: str(v) for k, v in stored.items()},
            },
            system_errors=[f.model_dump(mode="json") for f in system_errors],
            findings=[f.model_dump(mode="json") for f in findings],
        ),
        schema=FinanceNarrative,
        prompt_version=prompt.VERSION,
        max_tokens=300,
    )

    return BillingCheckResponse(
        # Findings are advisory by construction: nothing acts on them without a
        # person, so the flag is always set.
        meta=outcome.meta(AIAgentType.BILLING_ACCURACY, requires_review=True),
        invoiceId=str(invoice.id),
        invoiceNumber=invoice.invoice_number,
        recomputed=recomputed,
        stored=stored,
        systemErrors=system_errors,
        findings=findings,
        notAssessed=not_assessed,
        clean=not (system_errors or findings),
        summary=narrative.summary if narrative else _describe(system_errors, findings),
    )


# ---------------------------------------------------------------------------
# The rules
# ---------------------------------------------------------------------------


def _recompute(lines, invoice: Invoice) -> dict[str, Decimal]:
    subtotal = sum((Decimal(line.amount) for line in lines), Decimal("0.00"))
    discount = Decimal(invoice.discount)
    tax = Decimal(invoice.tax)
    return {
        "subtotal": subtotal,
        "discount": discount,
        "tax": tax,
        "total": subtotal - discount + tax,
    }


def _line_arithmetic(lines) -> list[BillingFinding]:
    findings = []
    for line in lines:
        expected = Decimal(line.quantity) * Decimal(line.rate)
        actual = Decimal(line.amount)
        if abs(expected - actual) > TOLERANCE:
            findings.append(
                BillingFinding(
                    code="arithmetic",
                    severity="high",
                    message=(
                        f"'{line.label}' is charged at {actual} but {line.quantity} × "
                        f"{line.rate} is {expected}."
                    ),
                    delta=actual - expected,
                    reference=line.label,
                )
            )
    return findings


def _zero_rated(lines) -> list[BillingFinding]:
    """Lines charged at nothing.

    A question, not an error. A zero-rated line is exactly what a waived charge
    looks like, and this application has no way to record that it was waived on
    purpose — so the check asks rather than asserts, and the ambiguity is named
    in ``notAssessed``.
    """
    findings = []
    for line in lines:
        if Decimal(line.rate) == 0 or Decimal(line.amount) == 0:
            findings.append(
                BillingFinding(
                    code="missing_rate",
                    severity="low",
                    message=(
                        f"'{line.label}' is on the invoice at zero. Confirm the charge was "
                        "waived deliberately rather than missed."
                    ),
                    reference=line.label,
                )
            )
    return findings


def _totals(invoice: Invoice, recomputed: dict[str, Decimal]) -> list[BillingFinding]:
    findings = []
    if abs(recomputed["subtotal"] - Decimal(invoice.subtotal)) > TOLERANCE:
        findings.append(
            BillingFinding(
                code="arithmetic",
                severity="high",
                message=(
                    f"The stored subtotal is {invoice.subtotal} but the lines add up to "
                    f"{recomputed['subtotal']}."
                ),
                delta=Decimal(invoice.subtotal) - recomputed["subtotal"],
                reference="subtotal",
            )
        )
    if abs(recomputed["total"] - Decimal(invoice.total)) > TOLERANCE:
        findings.append(
            BillingFinding(
                code="arithmetic",
                severity="high",
                message=(
                    f"The stored total is {invoice.total} but subtotal minus discount plus "
                    f"tax is {recomputed['total']}."
                ),
                delta=Decimal(invoice.total) - recomputed["total"],
                reference="total",
            )
        )
    if Decimal(invoice.discount) > Decimal(invoice.subtotal):
        findings.append(
            BillingFinding(
                code="arithmetic",
                severity="high",
                message="The discount is larger than the subtotal.",
                delta=Decimal(invoice.discount) - Decimal(invoice.subtotal),
                reference="discount",
            )
        )
    return findings


def _duplicates(lines) -> list[BillingFinding]:
    """Identical lines on one invoice.

    Not automatically an error — two of the same therapy session on one day is
    a real thing — so this is raised as a question at low severity rather than
    as a correction.
    """
    seen: dict[tuple[str, Decimal, int], int] = {}
    for line in lines:
        key = (line.label.strip().lower(), Decimal(line.rate), line.quantity)
        seen[key] = seen.get(key, 0) + 1
    return [
        BillingFinding(
            code="duplicate_line",
            severity="low",
            message=(
                f"'{label}' appears {count} times at the same rate and quantity. "
                "Confirm it was delivered more than once."
            ),
            reference=label,
        )
        for (label, _, _), count in seen.items()
        if count > 1
    ]


def _payments(invoice: Invoice, paid: Decimal) -> list[BillingFinding]:
    total = Decimal(invoice.total)
    findings = []
    if paid > total + TOLERANCE:
        findings.append(
            BillingFinding(
                code="payment_mismatch",
                severity="high",
                message=f"Payments total {paid} against an invoice of {total}. The patient is owed a refund.",
                delta=total - paid,
                reference="payments",
            )
        )
    if invoice.status is InvoiceStatus.PAID and paid + TOLERANCE < total:
        findings.append(
            BillingFinding(
                code="payment_mismatch",
                severity="high",
                message=f"Marked paid, but only {paid} of {total} has been settled.",
                delta=total - paid,
                reference="status",
            )
        )
    if invoice.status is InvoiceStatus.UNPAID and paid > TOLERANCE:
        findings.append(
            BillingFinding(
                code="payment_mismatch",
                severity="medium",
                message=f"Marked unpaid, but {paid} has been received against it.",
                delta=paid,
                reference="status",
            )
        )
    return findings


def _unbilled(db: Session, *, invoice: Invoice, lines) -> tuple[list[BillingFinding], list[str]]:
    """Services delivered in the window with no plausible line for them.

    Every one of these would *increase* a bill if acted on, which is exactly
    why they are findings and not adjustments. They are also the least certain
    of the checks — matching a service to a free-text line label is a heuristic
    — so they are raised at medium severity with wording that asks rather than
    asserts.

    Three exclusions keep the false-positive rate honest:

    * cancelled and unattended sessions never reach here at all, because
      :func:`app.ai.retrieval.billable_activity` filters them out;
    * lines on *other* invoices for the same patient in the same window count
      as billed — otherwise splitting a month across two invoices makes both of
      them look incomplete;
    * where the department has no matching service concept, the rule does not
      run and says so.

    Returns the findings and the list of things it could not assess.
    """
    activity_kind = _DEPARTMENT_ACTIVITY.get(invoice.department)
    if activity_kind is None:
        return [], [
            f"{invoice.department.display} invoices are not checked for unbilled services: "
            "this application does not model which delivered records they correspond to."
        ]

    window_end = invoice.issued_on
    window_start = window_end - timedelta(days=WINDOW_DAYS)
    delivered = [
        row
        for row in retrieval.billable_activity(
            db,
            patient_id=invoice.patient_id,
            window_start=window_start,
            window_end=window_end,
        )
        if row["kind"] == activity_kind
    ]
    not_assessed = list(UNMODELLED_CONCEPTS)
    if not delivered:
        return [], not_assessed

    keywords = _ACTIVITY_KEYWORDS[activity_kind]
    on_this_invoice = _matching_quantity(lines, keywords)
    elsewhere = _billed_elsewhere(db, invoice=invoice, keywords=keywords,
                                  window_start=window_start, window_end=window_end)
    billed = on_this_invoice + elsewhere

    if billed >= len(delivered):
        return [], not_assessed

    missing = len(delivered) - billed
    dates = ", ".join(f"{row['date']:%d %b}" for row in delivered[-5:])
    other = (
        f" ({elsewhere} more on the patient's other invoices in this window)"
        if elsewhere
        else ""
    )
    return (
        [
            BillingFinding(
                code="unbilled_service",
                severity="medium",
                message=(
                    f"{len(delivered)} completed {activity_kind} record(s) exist between "
                    f"{window_start:%d %b} and {window_end:%d %b} ({dates}) but "
                    f"{billed} appear to be charged{other}. Check whether {missing} "
                    "should be billed. Nothing has been added to the invoice."
                ),
                reference=activity_kind,
            )
        ],
        not_assessed,
    )


def _matching_quantity(lines, keywords: tuple[str, ...]) -> int:
    return sum(
        line.quantity for line in lines if any(word in line.label.lower() for word in keywords)
    )


def _billed_elsewhere(
    db: Session, *, invoice: Invoice, keywords: tuple[str, ...], window_start, window_end
) -> int:
    """Matching lines on the patient's *other* invoices in the same window.

    Without this, a clinic that bills therapy weekly and consultations monthly
    gets an unbilled-service finding on every invoice it raises, for work it
    charged for correctly on a different one.
    """
    rows = db.execute(
        select(InvoiceItem)
        .join(Invoice, Invoice.id == InvoiceItem.invoice_id)
        .where(
            Invoice.patient_id == invoice.patient_id,
            Invoice.id != invoice.id,
            Invoice.issued_on >= window_start,
            Invoice.issued_on <= window_end,
        )
    ).scalars()
    return _matching_quantity(list(rows), keywords)


def _describe(system_errors: list[BillingFinding], findings: list[BillingFinding]) -> str:
    """The summary written without a model.

    Counts what the two lists hold and stops. It exists so that a degraded run
    still puts a sentence at the top of the panel, and it says nothing the
    lists below it do not.
    """
    if not system_errors and not findings:
        return "The stored figures add up and nothing was flagged for review."
    parts = []
    if system_errors:
        parts.append(
            f"{len(system_errors)} arithmetic problem(s) in the stored figures"
        )
    if findings:
        parts.append(f"{len(findings)} item(s) for someone to check")
    return f"Found {' and '.join(parts)}."
