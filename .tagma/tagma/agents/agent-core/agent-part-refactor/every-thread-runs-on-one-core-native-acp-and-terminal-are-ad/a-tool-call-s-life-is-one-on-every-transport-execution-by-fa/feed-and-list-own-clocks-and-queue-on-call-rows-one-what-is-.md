---
id: 01a126a2-f822-75ab-8f5e-481c28a0b015
title: "Feed and list: own clocks and queue on call rows, one 'what is going' from ThreadPhase, awaited-target run, honest outcomes"
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a126a3-dbf4-7264-bf8b-963cb35aae0b",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a12685-91d6-74c9-bb18-016b7edf92bf
---
Feed and thread list: items 5 (outcome rendering), 7 (`wait_call` and `wait_terminal` display), 8 (`CallControls`), and 11 of the [[7edf92bf]] spec.

What to do:
- `ThreadPhaseFeed`: call time from `execution.at`, `queued` in a separate count, no `input-streaming`; on starting to watch it reads the run's open records; no `Date.now()`.
- One "what is going" formatting function in `packages/chat-ui` for `LiveRunRow` and `workLine.ts`; the summary row reads `ThreadPhase`; `chatThreadPhaseLabel`, `runningCalls`, and the `feed.live.length` count go away.
- `ActivityStep`: `started` gets its own clock from `execution.at`; `queued` gets a hollow dot and `· queued`; `output-unknown` is not a failure (`· outcome unknown`, outside the group error count and folding); `output-cancelled` renders `· cancelled`.
- Awaiting a command renders the target's `CommandStatus` next to `WaitStatus`; an open row's expansion shows the input and the target's command line.
- `ToolDisplay.reference` gains `call` and `terminal` kinds; `wait_call` and `wait_terminal` declare a display with `awaitsMs`; the row renders the target from the registry or the `ProcessLine`.
- `CallControls` substitutes at most `CallRecord.limitCeilingMs` (the core task adds the field).
- `awaitsUntil` and `toolAwaitingMs` are deleted.

Done when criteria 8, 9, 13 of the spec are proven, typecheck, lint, and the affected package tests are green, review under the model rule passes.
