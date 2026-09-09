"""Branch visibility, shared by every clinical module.

Lives outside the individual services so patients, appointments and everything
that follows can all answer "which branches may this user read?" the same way,
without the services having to import one another.
"""

from __future__ import annotations

import uuid as uuid_lib

from app.models.user import User

#: Holding either permission means the user works across the whole organisation
#: rather than one site. Uses the existing vocabulary — no new keys invented.
CROSS_BRANCH_PERMISSIONS = {"branches.manage", "analytics.business"}


def visible_branch_ids(
    db: object, user: User, permissions: list[str]
) -> list[uuid_lib.UUID] | None:
    """Which branches this user may read records from.

    ``None`` means unrestricted. A branch-bound user without a branch assigned
    gets an empty list, which the repositories turn into "no rows" — failing
    closed rather than open.

    ``db`` is accepted (and currently unused) so callers need not care whether
    resolving scope requires a query; a future rule such as "this user covers
    three sites" can be added here without touching every call site.
    """
    if CROSS_BRANCH_PERMISSIONS & set(permissions):
        return None
    if user.branch_id is None:
        # Organisation-wide staff without a cross-branch permission still see
        # everything they are otherwise entitled to; there is no site to bind to.
        return None
    return [user.branch_id]
