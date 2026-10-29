---
id: 01a0c4f7-9243-736f-ac93-0c482f65a83d
title: The six modules of the GLM cut, and the direction between them
ord: 1
---
The six modules [[b351bf7b|GLM]] cut, read for what each holds.

- **`AgentTurnSettlement`** (88 lines) — a class over the run's endings: the live `steps` array every reader and stop condition sees, the `closed` latch, and the five ending `Deferred`s.
- **`AgentTurnAttempt`** (287) — one model call: the turn slice it reads, plus that attempt's framing state — buffered pre-output events, the folded response, `spoken`/`released`/`outputStarted`.
- **`AgentStreamedInputs`** (84) — the map of partial-JSON readers per open call, each with its closed fields, completion and last published title, created fresh per attempt where the map was created before.
- **`AgentToolBatch`** (286) — one step's batch: the prepared calls with their path subjects, and per batch the completion `Deferred`s and dependency edges.
- **`AgentStepFold`** (99) — pure: the outcome vocabulary and the fold of response plus outcomes into the step the settlement commits.
- **`AgentModelContext`** (28) — the window-projection types alone, moved out of `AgentRunner.ts`.

Direction: the residual imports the settlement, the attempt, the batch and the fold; the settlement and the batch import the fold; the attempt imports the streamed inputs; the fold, the streamed inputs and the context types import none of them.
