# Step 14 audit — weaknesses found before any Step 15 code was written

Recorded before modification so the fixes can be checked against the findings
rather than against a memory of them. Each row names the spec clause it fails.

## Orchestrator and platform

| # | Weakness | Clause |
| --- | --- | --- |
| W1 | One global rate limit shared by all five agents. A user burning 60 recaps locks themselves out of billing checks. | §28 |
| W2 | No token or cost capture. `ai_audit_logs` has no `input_tokens` / `output_tokens` / `estimated_cost`. | §29 |
| W3 | Latency is stored per row but nothing aggregates it; no p50/p95 anywhere. | §30 |
| W4 | No retry for transient provider failures. The two-attempt loop is a *validation repair* loop; a single connection reset kills the run. | §32 |
| W5 | `prompt_version` is tracked, `agent_version` is not. | §42 |
| W6 | A timeout is reported as "could not be reached" — indistinguishable from DNS failure or a refused connection. | §31 |
| W7 | The RATE_LIMITED audit row is written into a transaction the raised `RateLimited` then rolls back. The refusal is never recorded. | §20 |
| W8 | No dedicated approval record. Approvals live on `ai_documents` / `message_drafts` plus generic `audit_logs`, so "every AI action a human approved" is not one query. | §20 |
| W9 | Untrusted text (OCR output, consultation notes) is concatenated into the user turn with no structural separation from the task. | §24 |

## Patient recap

| # | Weakness | Clause |
| --- | --- | --- |
| W10 | Timeline events carry no source reference, so "View source" cannot be built. | §4, §47 |
| W11 | Vitals are absent from the timeline entirely — the clause's own worked example (SpO2 traced to a vital record) is unbuildable. | §4 |
| W12 | No contradiction detection. Two consultations naming different current medications both appear, and the model is left to pick. | §5 |
| W13 | Future-dated records are rendered exactly like events that happened. | §3 |
| W14 | No explicit "Not available in the patient's records" wording for absent data. | §3 |

## Clinical documentation

| # | Weakness | Clause |
| --- | --- | --- |
| W15 | Confidence is one document-level band. No per-field flagging of medicine / dose / frequency / duration / patient name / date. | §7 |
| W16 | No matching of an extracted medicine name against the `medicines` table at all. | §8 |
| W17 | Nothing checks that a structured value actually appears in the OCR text. "OCR: 5 mg → AI: 500 mg" would pass silently. | §9 |

## Billing

| # | Weakness | Clause |
| --- | --- | --- |
| W18 | Arithmetic errors are returned in the same `findings` list as heuristics, labelled like an AI finding. A wrong total is a system error, not a suggestion. | §12 |
| W19 | Cancelled therapy sessions and cancelled appointments count as "delivered" in the unbilled check — a guaranteed false positive. | §14 |
| W20 | Already-billed-on-another-invoice is not checked. Only the invoice under review is inspected for a matching line. | §14 |

## Follow-up

| # | Weakness | Clause |
| --- | --- | --- |
| W21 | An existing appointment silently suppresses the candidate instead of being tier 2 of the priority order. | §15 |
| W22 | Missed appointments are not handled at all. | §16 |

## Finance

| # | Weakness | Clause |
| --- | --- | --- |
| W23 | A driver carries a delta and a share but not the before/after figures that make it explainable. | §23 |

## Tests and frontend

| # | Weakness | Clause |
| --- | --- | --- |
| W24 | No 422, no 429 and no cross-branch test on any AI endpoint. | §44 |
| W25 | No evaluation dataset. Every guardrail is asserted, none is measured. | §35–§40 |
| W26 | No "View source" affordance on the recap. | §47 |
| W27 | The AI dashboard shows queues but no usage, cost or latency. | §49 |
