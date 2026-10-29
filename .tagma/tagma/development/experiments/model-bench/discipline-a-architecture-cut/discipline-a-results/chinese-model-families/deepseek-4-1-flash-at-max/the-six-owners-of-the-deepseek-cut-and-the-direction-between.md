---
id: 01a0c4f7-925a-7461-b3cb-0e1cbd88443e
title: The six owners of the DeepSeek cut, and the direction between them
ord: 1
---
The six owners [[16741b4e|DeepSeek]] cut, each read for the state it holds rather than the name it carries.

- **`AgentTurnLedger`** (133 lines) — the turn's committed record and its ending: `steps`, `closed`, the five ending faces as `Deferred`s, and the run's usage total.
- **`AgentModelCall`** (307) — one call attempt: its own abort signal, the projected request, the pre-output framing buffer (`buffered`, `outputStarted`, `released`), the wire fold (`folded`) and what ended the attempt.
- **`AgentToolBatch`** (307) — one step's calls: the prepared list and one completion cell per call, with the path-overlap wait edges those accesses create.
- **`AgentToolInputDraft`** (78) — one draft per call id, released when the call closes: the partial JSON reader, the closed fields and the title last published.
- **`AgentStepInjection`** (44) — `taken`, the one injection a step made, so both attempts of that step read what the first took.
- **`AgentTurnStep`** (208) — the step's order of acts, its one attempt plus overflow replay, and the decision to continue.

The direction between them is a DAG with no upward reach: the turn imports the four it composes; the step imports the call, the batch, the ledger and the injection; the call imports the injection and the drafts; the ledger, the batch, the drafts and the injection import none of the new modules, and nothing below the loop reaches `AgentRunner`.
