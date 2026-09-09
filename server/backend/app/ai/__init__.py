"""The AI layer.

Nothing else in the HMS imports from here except ``app/api/ai.py``. That is
deliberate: if this whole package were deleted, every clinical, billing and
scheduling feature would still work. AI is an enhancement, not a dependency.

The flow is always the same, and the order matters:

    request -> permission check -> deterministic retrieval from PostgreSQL
            -> structured context -> model (optional) -> schema validation
            -> human review -> only then a real record

The model never sees the database. It is handed a small, already-authorised
context and asked to write prose about it. Every number, date and total in an
AI response is computed in Python or SQL, so an unavailable — or wrong —
model degrades the writing, never the arithmetic.
"""

from __future__ import annotations
