---
id: 01a0c4f7-9258-7163-86c6-85b116741b4e
title: DeepSeek 4.1 Flash at max
ord: 3
---
DeepSeek 4.1 Flash at max leaves the smallest residual of the field — 154 lines — and every one of its six owners holds state rather than methods.

- **The residual is the loop and nothing else:** the composition of four owners, the step cycle, the terminal-finish verdict and the public contract. What each owner holds is read one by one below.
- **It is the only run that moved a declaration OUT of the module above it.** `AgentModelContext` and `AgentModelContextInput` went from `AgentRunner.ts` down to `AgentModelCall.ts`, and `AgentStreamOutput` down to the ledger, each re-exported from its old home so every importer compiles untouched. That is law 2 applied where it costs something, not quoted.
- **The subtle state survived.** The original held one injection cell per STEP so the overflow replay does not drain signals twice; the new injection owner is built inside the step, not once per turn — built a level higher, the second step would inject nothing and no gate would say so.
- **The collision shipped.** `AgentToolOutcome` was private in the original and is exported here, so two exported types of that name stand in one directory beside `AgentToolDoor`'s. No Opus row did this. `agentToolSources` also stayed in the residual.
- **Measured, not reported.** The gates, the changed-file scope and the cost were re-read in the guest; the report claims nothing the diff denies.
