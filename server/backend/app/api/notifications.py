"""Notifications and global search.

Two routers with two different scoping rules.

Notifications need no permission key at all — every signed-in user has their
own, and the only authorisation question is "is this yours?", which is answered
by the query rather than by a guard. There is deliberately no way to ask for
another user's: the owner is the authenticated caller, never a request field.

Search needs no key either, but each *category* inside it does. A caller sees
patients only if they hold `patient.view`, invoices only with `billing.view`,
and so on — so the palette can never return more than the rest of the
application already would.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.core.dependencies import (
    CurrentPermissions,
    CurrentUser,
    DbSession,
)
from app.schemas.notification import (
    NotificationPage,
    ReadResult,
    SearchResults,
    UnreadCount,
)
from app.services import notification_service as service

router = APIRouter(tags=["Notifications"])
search_router = APIRouter(tags=["Search"])

_NOT_FOUND = {
    "description": "No such notification, or it belongs to another user",
    "content": {
        "application/json": {
            "example": {"detail": "Notification not found.", "code": "not_found"}
        }
    },
}


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------


@router.get(
    "",
    response_model=NotificationPage,
    summary="Your notifications",
    description=(
        "Newest first, and **only the authenticated user's own**. There is no "
        "parameter for whose notifications to return — the owner is the caller.\n\n"
        "`unread` is the count across the whole account rather than this page, "
        "because it is what the bell's badge shows."
    ),
)
def list_notifications(
    db: DbSession,
    user: CurrentUser,
    page: Annotated[int, Query(ge=1)] = 1,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    unread: bool = False,
) -> NotificationPage:
    return service.list_notifications(db, user=user, page=page, limit=limit, unread_only=unread)


@router.get(
    "/unread-count",
    response_model=UnreadCount,
    summary="Unread badge count",
    description="Served straight from `ix_notifications_user_read_created`.",
)
def unread_count(db: DbSession, user: CurrentUser) -> UnreadCount:
    return service.unread(db, user=user)


@router.post(
    "/{identifier}/read",
    response_model=ReadResult,
    summary="Mark one as read",
    description=(
        "Answers 404 both when the notification does not exist and when it "
        "belongs to somebody else — the two are indistinguishable on purpose.\n\n"
        "`updated` is 0 when it was already read, rather than reporting work "
        "that did not happen."
    ),
    responses={404: _NOT_FOUND},
)
def mark_read(db: DbSession, user: CurrentUser, identifier: str) -> ReadResult:
    return service.mark_read(db, identifier=identifier, user=user)


@router.post(
    "/read-all",
    response_model=ReadResult,
    summary="Mark every one of yours as read",
)
def mark_all_read(db: DbSession, user: CurrentUser) -> ReadResult:
    return service.mark_all_read(db, user=user)


# ---------------------------------------------------------------------------
# Global search
# ---------------------------------------------------------------------------


@search_router.get(
    "",
    response_model=SearchResults,
    summary="Global search",
    description=(
        "Searches the modules the caller already has permission to read, and "
        "returns navigation, not data: a name, a code and a URL.\n\n"
        "**A hit never carries clinical or financial detail.** The palette is "
        "reachable from every screen by every role, so answering richly would "
        "be the cheapest way in the application to leak a diagnosis to the "
        "front desk.\n\n"
        "Categories a caller lacks the permission for are absent from the "
        "response rather than returned empty. Ranking puts an exact patient "
        "number first, then an exact name, then a prefix, then a partial "
        "match. Every category is a separate indexed query with its own limit."
    ),
)
def global_search(
    db: DbSession,
    user: CurrentUser,
    permissions: CurrentPermissions,
    q: Annotated[str, Query(min_length=0, max_length=120, description="At least 2 characters")] = "",
    limit: Annotated[int, Query(ge=1, le=20, description="Per category")] = 5,
) -> SearchResults:
    return service.search(db, query=q, user=user, permissions=permissions, limit=limit)
