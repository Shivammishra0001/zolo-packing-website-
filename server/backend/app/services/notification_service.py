"""Notifications and global search.

Two rules shape this module.

**A notification belongs to a user, and only that user can see or touch it.**
The owner is never taken from a request: every read filters on the
authenticated caller's id, and both mark-read paths put that id in the WHERE
clause, so a valid notification id belonging to somebody else simply matches
nothing.

**Search is a navigation aid, not a data feed.** A hit carries a name, a code
and a URL. It never carries a diagnosis, a note, a balance or a phone number,
because the palette is reachable by every signed-in role and the cheapest way
to leak clinical data across roles would be to let it answer richly. Which
categories a caller sees is decided by the permissions they already hold.
"""

from __future__ import annotations

import logging
import uuid as uuid_lib
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.enums import NotificationIcon, NotificationSeverity, UserRole
from app.core.errors import NotFoundError
from app.models.notification import Notification
from app.models.user import User
from app.repositories import notification_repository as repo
from app.repositories import user_repository as users_repo
from app.schemas.notification import (
    NotificationPage,
    NotificationResponse,
    ReadResult,
    SearchGroup,
    SearchHit,
    SearchResults,
    UnreadCount,
)
from app.services.scoping import visible_branch_ids

logger = logging.getLogger(__name__)

#: Which permission a search category needs, and what the palette calls it.
#: A caller who lacks the permission does not get an empty group — the group is
#: absent, because its existence would itself say something.
SEARCH_CATEGORIES: tuple[tuple[str, str, str], ...] = (
    ("patient", "Patients", "patient.view"),
    ("appointment", "Appointments", "appointment.view"),
    ("staff", "Staff", "staff.manage"),
    ("prescription", "Prescriptions", "prescription.create"),
    ("medicine", "Medicines", "pharmacy.inventory"),
    ("invoice", "Invoices", "billing.view"),
)

#: Anything shorter matches most of the database and helps nobody.
MIN_QUERY_LENGTH = 2


def _relative(value: datetime | None) -> str:
    """"9 minutes ago" — the phrasing the bell menu already renders."""
    if value is None:
        return ""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)

    seconds = (datetime.now(timezone.utc) - value).total_seconds()
    if seconds < 60:
        return "Just now"
    if seconds < 3600:
        minutes = int(seconds // 60)
        return f"{minutes} minute{'s' if minutes > 1 else ''} ago"
    if seconds < 86_400:
        hours = int(seconds // 3600)
        return f"{hours} hour{'s' if hours > 1 else ''} ago"
    days = int(seconds // 86_400)
    if days == 1:
        return "Yesterday"
    if days < 7:
        return f"{days} days ago"
    return value.strftime("%d %b")


def notification_out(row: Notification) -> NotificationResponse:
    return NotificationResponse(
        id=str(row.id),
        title=row.title,
        body=row.body or "",
        time=_relative(row.created_at),
        icon=row.icon,
        severity=row.severity,
        read=row.read,
        href=row.href or "",
        createdAt=row.created_at,
    )


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------


def list_notifications(
    db: Session, *, user: User, page: int = 1, limit: int = 20, unread_only: bool = False
) -> NotificationPage:
    rows, total = repo.list_for_user(
        db,
        user.id,
        unread_only=unread_only,
        offset=(page - 1) * limit,
        limit=limit,
    )
    return NotificationPage(
        items=[notification_out(row) for row in rows],
        # Across the whole account, not just this page — it is a badge, not a count of rows.
        unread=repo.unread_count(db, user.id),
        page=page,
        limit=limit,
        total=total,
        total_pages=max(1, -(-total // limit)),
    )


def unread(db: Session, *, user: User) -> UnreadCount:
    return UnreadCount(unread=repo.unread_count(db, user.id))


def mark_read(db: Session, *, identifier: str, user: User) -> ReadResult:
    try:
        notification_id = uuid_lib.UUID(identifier)
    except (ValueError, AttributeError):
        raise NotFoundError("Notification not found.") from None

    if repo.get_for_user(db, user.id, notification_id) is None:
        # 404 whether it does not exist or belongs to someone else — the two are
        # indistinguishable on purpose.
        raise NotFoundError("Notification not found.")

    updated = repo.mark_read(db, user.id, notification_id)
    db.commit()
    return ReadResult(updated=updated, unread=repo.unread_count(db, user.id))


def mark_all_read(db: Session, *, user: User) -> ReadResult:
    updated = repo.mark_all_read(db, user.id)
    db.commit()
    return ReadResult(updated=updated, unread=repo.unread_count(db, user.id))


# ---------------------------------------------------------------------------
# Writing — called by the modules whose events these are
# ---------------------------------------------------------------------------


def notify(
    db: Session,
    *,
    user_id: uuid_lib.UUID,
    title: str,
    body: str,
    icon: NotificationIcon,
    severity: NotificationSeverity = NotificationSeverity.INFO,
    href: str | None = None,
) -> Notification:
    """Queue one alert for one user.

    The caller owns the transaction. A notification is a side effect of a
    business event, so it joins that event's transaction rather than committing
    on its own — and if the event rolls back, the alert about it goes too.
    """
    row = Notification(
        user_id=user_id,
        title=title,
        body=body,
        icon=icon,
        severity=severity,
        href=href,
    )
    db.add(row)
    return row


def notify_roles(
    db: Session,
    *,
    roles: tuple[UserRole, ...],
    branch_id: uuid_lib.UUID | None,
    title: str,
    body: str,
    icon: NotificationIcon,
    severity: NotificationSeverity = NotificationSeverity.INFO,
    href: str | None = None,
    exclude: uuid_lib.UUID | None = None,
) -> int:
    """Fan one event out to whoever holds a role at that site.

    Scoped to the branch the event happened at, so a low-stock alert at one
    campus does not reach the pharmacist at another. Staff with no branch are
    organisation-wide and are included deliberately.
    """
    recipients = users_repo.active_by_roles(db, roles, branch_id)
    sent = 0
    for recipient in recipients:
        if exclude is not None and recipient.id == exclude:
            continue
        notify(
            db,
            user_id=recipient.id,
            title=title,
            body=body,
            icon=icon,
            severity=severity,
            href=href,
        )
        sent += 1
    return sent


# ---------------------------------------------------------------------------
# Global search
# ---------------------------------------------------------------------------


def search(
    db: Session, *, query: str, user: User, permissions: list[str], limit: int = 5
) -> SearchResults:
    """Look across the modules this caller is already entitled to read.

    Every category is a separate indexed query with its own `LIMIT`, run in
    PostgreSQL. Nothing is fetched and filtered here.
    """
    term = (query or "").strip()
    if len(term) < MIN_QUERY_LENGTH:
        return SearchResults(query=term, groups=[], total=0)

    per_category = max(1, min(limit, repo.MAX_PER_CATEGORY))
    branch_ids = visible_branch_ids(db, user, permissions)
    held = set(permissions)
    groups: list[SearchGroup] = []

    for kind, label, permission in SEARCH_CATEGORIES:
        if permission not in held:
            continue

        hits: list[SearchHit] = []

        if kind == "patient":
            hits = [
                SearchHit(
                    type="patient",
                    id=row.patient_number,
                    title=row.full_name,
                    # A code, not a condition — see the module docstring.
                    subtitle=row.patient_number,
                    url=f"/patients/{row.patient_number}",
                )
                for row in repo.search_patients(db, term, branch_ids, per_category)
            ]
        elif kind == "appointment":
            hits = [
                SearchHit(
                    type="appointment",
                    id=row.appointment_number,
                    title=row.patient.full_name,
                    subtitle=f"{row.appointment_date:%d %b} · {row.appointment_number}",
                    url="/appointments",
                )
                for row in repo.search_appointments(db, term, branch_ids, per_category)
            ]
        elif kind == "staff":
            hits = [
                SearchHit(
                    type="staff",
                    id=row.user_number,
                    title=row.full_name,
                    subtitle=f"{row.role.display} · {row.user_number}",
                    url="/admin/staff",
                )
                for row in repo.search_staff(db, term, branch_ids, per_category)
            ]
        elif kind == "prescription":
            hits = [
                SearchHit(
                    type="prescription",
                    id=row.prescription_number,
                    title=row.prescription_number,
                    subtitle=row.patient.full_name,
                    url=f"/prescriptions/{row.prescription_number}",
                )
                for row in repo.search_prescriptions(db, term, branch_ids, per_category)
            ]
        elif kind == "medicine":
            hits = [
                SearchHit(
                    type="medicine",
                    id=row.medicine_number,
                    title=row.name,
                    subtitle=row.generic_name or row.medicine_number,
                    url="/pharmacy/inventory",
                )
                for row in repo.search_medicines(db, term, per_category)
            ]
        elif kind == "invoice":
            hits = [
                SearchHit(
                    type="invoice",
                    id=row.invoice_number,
                    title=row.invoice_number,
                    subtitle=row.patient.full_name,
                    url="/invoices",
                )
                for row in repo.search_invoices(db, term, branch_ids, per_category)
            ]

        if hits:
            groups.append(SearchGroup(type=kind, label=label, hits=hits))

    total = sum(len(group.hits) for group in groups)
    # The term itself is not logged: someone searching a patient's name is
    # clinical context, and the log is not the place for it.
    logger.info("Search by %s returned %s hit(s) across %s group(s)", user.id, total, len(groups))
    return SearchResults(query=term, groups=groups, total=total)
