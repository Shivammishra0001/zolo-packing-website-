"""The five agents.

Each one is built the same way, and the shape is worth stating once because it
is the thing that makes the whole layer safe to run with no model configured:

1. retrieve, through :mod:`app.ai.retrieval`, under the caller's permissions;
2. compute the answer deterministically — the timeline, the totals, the dates;
3. optionally ask a model to *describe* what was computed;
4. validate that description, and drop it if it does not validate;
5. return both halves, labelled, with the provenance attached.

Step 2 is never skipped and step 3 is never load-bearing. Delete every provider
key and each agent still returns a correct answer with an empty narrative,
which is why the AI layer cannot take the HMS down with it.
"""

from __future__ import annotations
