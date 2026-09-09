"""The AI evaluation suite.

Synthetic cases only. Nothing in here is derived from a real patient, and the
builders in :mod:`tests.ai_eval.synthetic` construct every row inside the
rolled-back session fixture, so a full run leaves the database exactly as it
found it.

The point of these tests is different from the point of the ones in
``test_ai.py``. Those assert that a guardrail exists. These *measure* how well
it works, print the measurement, and fail only if it drops below a floor
recorded in the file. That distinction matters when a prompt changes: an
assertion tells you the code still runs, a measurement tells you whether the
change made the output better or worse.

**No result in here is 100%, and none is asserted to be.** The document reader
misses things. The billing heuristic has false positives. Both numbers are
printed on every run so a regression shows up as a number moving, rather than
as a test that quietly still passes.
"""

from __future__ import annotations
