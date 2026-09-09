"""Notifications, global search and reports.

Field names mirror the frontend's `Notification` type in `src/types/index.ts`.
The one difference is deliberate: the mock carried a `role` so the browser could
decide which alerts to show. A real notification belongs to a **user**, and the
API only ever returns the authenticated caller's own — so there is no `role` to
send, and no way to ask for somebody else's.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.core.enums import NotificationIcon, NotificationSeverity

# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------


class NotificationResponse(BaseModel):
    """Matches the frontend's ``Notification`` interface, minus `role`."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    body: str = ""
    #: "9 minutes ago" — the phrasing the bell menu already renders.
    time: str
    icon: NotificationIcon
    severity: NotificationSeverity
    read: bool
    #: The route the alert deep-links to, e.g. /pharmacy/inventory.
    href: str = ""
    createdAt: datetime


class NotificationPage(BaseModel):
    items: list[NotificationResponse]
    #: Unread across the whole account, not just this page.
    unread: int
    page: int
    limit: int
    total: int
    total_pages: int


class UnreadCount(BaseModel):
    """What the bell's badge reads."""

    unread: int


class ReadResult(BaseModel):
    """How many rows the call actually marked, and what is left."""

    updated: int
    unread: int


# ---------------------------------------------------------------------------
# Global search
# ---------------------------------------------------------------------------


class SearchHit(BaseModel):
    """One result, deliberately thin.

    A search result carries a name, a code and somewhere to go — never a
    diagnosis, a note or a balance. The palette is reachable by every signed-in
    role, so anything richer would leak across roles the moment someone typed a
    patient's name.
    """

    type: str = Field(examples=["patient"])
    id: str
    title: str
    subtitle: str = ""
    url: str


class SearchGroup(BaseModel):
    """One labelled section of the palette."""

    type: str
    label: str
    hits: list[SearchHit] = Field(default_factory=list)


class SearchResults(BaseModel):
    query: str
    groups: list[SearchGroup] = Field(default_factory=list)
    total: int = 0
