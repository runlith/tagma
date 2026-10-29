---
id: 01a0c4f7-9257-7119-b738-404106a034de
title: "GPT-5.6 Terra at max: three owners, each handed only what it uses"
ord: 7
---
Terra at max cuts three owners and leaves a 279-line residual, handing each owner a named list of what it uses rather than the run's whole world.

- **The cut.** `AgentTurnState` holds the steps, the five deferred faces and the closed latch; `AgentStepCall` holds the per-step injection across an attempt and its overflow retry, and its attempt holds the stream fold; `AgentToolBatch` holds the prepared calls and the completion gates.
- **Inputs are enumerated.** The call owner is constructed with thirteen named fields and takes `previousStep` as a VALUE, so it never reaches into the ledger's live array — the distinction Astra at low and Muse at max resolve the other way.
- **Composition reads as one act.** The residual asks the state for its output, its events and its abort, and keeps only sequencing, step assembly and the terminal helpers.
- **The collision was missed.** `AgentToolOutcome` is exported from the new batch beside the same exported name in `AgentToolDoor`.
- **`agentToolSources` stayed** in the residual, as it did for every contestant but Opus.
- **Cost.** 15 minutes and 45k written tokens — roughly Opus's shape at a third of Opus's spend, which is the reason this row is worth its own reading.
