"""Server-side PDF generation.

Generated here rather than in the browser so that one canonical document
exists. An invoice is a financial record: two people printing the same invoice
from different browsers must not get two different documents.

Only what belongs on the document goes on it. An invoice carries the charge and
how it was settled — never a diagnosis, a consultation note or anything else
from the clinical record, however easily the service layer could reach it.
"""

from __future__ import annotations

import io
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.core.config import settings
from app.schemas.billing import InvoiceResponse

#: Rendered as "INR" rather than the rupee sign, because the built-in Type 1
#: fonts have no glyph for it and would emit a black box on every line.
CURRENCY = "INR"

_INK = colors.HexColor("#0f172a")
_MUTED = colors.HexColor("#64748b")
_RULE = colors.HexColor("#e2e8f0")
_WASH = colors.HexColor("#f8fafc")


def _money(value) -> str:
    return f"{CURRENCY} {value:,.2f}"


def _styles():
    sheet = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "title", parent=sheet["Title"], fontSize=20, textColor=_INK, alignment=0, spaceAfter=2
        ),
        "muted": ParagraphStyle("muted", parent=sheet["Normal"], fontSize=9, textColor=_MUTED),
        "body": ParagraphStyle("body", parent=sheet["Normal"], fontSize=10, textColor=_INK),
        "heading": ParagraphStyle(
            "heading", parent=sheet["Normal"], fontSize=8, textColor=_MUTED, spaceAfter=3
        ),
    }


def invoice_pdf(invoice: InvoiceResponse, clinic_name: str | None = None) -> bytes:
    """Render one invoice as a PDF.

    Deliberately contains no clinical information: the line labels describe what
    was charged for, which is as far as an invoice needs to go.
    """
    clinic_name = clinic_name or settings.CLINIC_NAME
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title=f"Invoice {invoice.id}",
        author=clinic_name,
    )
    style = _styles()
    story = []

    # --- header -----------------------------------------------------------
    story.append(Paragraph(clinic_name, style["title"]))
    story.append(Paragraph(invoice.branch or "", style["muted"]))
    story.append(Spacer(1, 10 * mm))

    meta = Table(
        [
            [
                Paragraph("BILLED TO", style["heading"]),
                Paragraph("INVOICE", style["heading"]),
            ],
            [
                Paragraph(
                    f"{invoice.patientName}<br/>{invoice.patientId}", style["body"]
                ),
                Paragraph(
                    f"{invoice.id}<br/>"
                    f"Issued {invoice.date:%d %b %Y}<br/>"
                    + (f"Due {invoice.dueDate:%d %b %Y}" if invoice.dueDate else ""),
                    style["body"],
                ),
            ],
        ],
        colWidths=[doc.width * 0.55, doc.width * 0.45],
    )
    meta.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    story.append(meta)
    story.append(Spacer(1, 8 * mm))

    # --- lines ------------------------------------------------------------
    rows: list[list] = [["Description", "Qty", "Rate", "Amount"]]
    for item in invoice.items:
        rows.append([
            Paragraph(item.label, style["body"]),
            str(item.qty),
            _money(item.rate),
            _money(item.amount),
        ])

    table = Table(rows, colWidths=[doc.width * 0.52, doc.width * 0.10, doc.width * 0.19, doc.width * 0.19])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), _WASH),
                ("TEXTCOLOR", (0, 0), (-1, 0), _MUTED),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LINEBELOW", (0, 0), (-1, -1), 0.4, _RULE),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.append(table)
    story.append(Spacer(1, 6 * mm))

    # --- totals -----------------------------------------------------------
    totals: list[list] = [["Subtotal", _money(invoice.subtotal)]]
    if invoice.discount:
        totals.append(["Discount", f"-{_money(invoice.discount)}"])
    if invoice.tax:
        totals.append(["Tax", _money(invoice.tax)])
    totals.append(["Total", _money(invoice.amount)])
    totals.append(["Paid", _money(invoice.paid)])
    totals.append(["Balance", _money(invoice.balance)])

    summary = Table(totals, colWidths=[doc.width * 0.62, doc.width * 0.38], hAlign="RIGHT")
    summary.setStyle(
        TableStyle(
            [
                ("ALIGN", (0, 0), (-1, -1), "RIGHT"),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("TEXTCOLOR", (0, 0), (0, -1), _MUTED),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                # The grand total and the outstanding balance are the two lines
                # anyone actually looks for.
                ("FONTNAME", (0, -3), (-1, -3), "Helvetica-Bold"),
                ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
                ("LINEABOVE", (0, -3), (-1, -3), 0.6, _RULE),
                ("TEXTCOLOR", (0, -3), (-1, -3), _INK),
                ("TEXTCOLOR", (0, -1), (-1, -1), _INK),
            ]
        )
    )
    story.append(summary)
    story.append(Spacer(1, 10 * mm))

    status_line = f"Status: {invoice.status.display}"
    if invoice.method:
        status_line += f" · Settled by {invoice.method.display}"
    story.append(Paragraph(status_line, style["body"]))
    story.append(Spacer(1, 4 * mm))
    story.append(
        Paragraph(
            f"Generated {datetime.now(settings.clinic_tz):%d %b %Y at %H:%M}. "
            "This document is a record of charges and payment only.",
            style["muted"],
        )
    )

    doc.build(story)
    return buffer.getvalue()
