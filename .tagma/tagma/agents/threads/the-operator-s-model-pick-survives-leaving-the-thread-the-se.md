---
id: 01a1a29b-cc6e-7724-b4e9-780d6fc9fd65
title: "The operator's model pick survives leaving the thread: the server keeps it and carries the running turn to the new road"
ord: 158
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a29c-1cf8-705a-b904-30f15caa6d47",
    "status": "in_work"
  }
edges:
  - kind: relates
    to: 01a10a41-1b43-775c-a6ea-957a076a4c60
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9280825673b8
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/models/preference.ts
  - kind: file
    ref: apps/tagma/server/src/threads/harness/moves.ts
  - kind: file
    ref: packages/agent/src/collaboration/modelCarry.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/thread/ThreadSettings.svelte.ts
---
**Defect.** The operator moves a running thread to a model on another road (native ↔ hosted harness, e.g. `openai-oauth` → `claude-code`), queues a word, leaves the thread and returns: the picker shows the old model, the turn goes on on the old model, and the queued word runs on it. Seen on thread `01a1a245-7a51-7739-a251-86d1ad1d1996` on 2026-11-03: a step compaction ran 17:58:35–18:01:04 inside run `01a1a28f`; the run carried no `stop` note `by: model` and continued on `gpt-6.1-sol` until the operator stopped it.

**Root.** A road change cannot land while a turn runs, and the server keeps the pick only inside the `set_thread_model` request: `ModelPreferences.setModelSettings` runs `ThreadHandle.carryModel` on the request's own fiber, waiting at most `STEP_WINDOW_MS` (3 min) for the next step boundary. The app sends that request from the thread view's `ThreadSettings` (tier `thread`); leaving the thread closes its scope, interrupts the RPC, and the server handler with it: the pick is dropped, admission is lifted, and the `TurnShaping` hold on the queued send is released, so the word reaches the inbox and runs on the row's old model. A boundary later than 3 minutes (a long compaction step or tool call) drops it the same way with `step-unreached`. Within one road the pick is written to the row at once and none of this happens.

**Fix.** The operator's pick is the thread's durable fact the moment it is made, and the server carries it to the road on its own lifetime:
- When a pick cannot land now (road change with a running turn), `set_thread_model` checks what can be refused statically, records the pick as the thread's pending pick (a `native_thread` column beside `pending_system_prompt`), and answers at once. Every landing of a pick clears the pending pick in its own transaction; a newer pick replaces it.
- One server-owned carrier per thread, outliving any request, takes the thread's `RunAdmission` before the pending pick is recorded and runs `carryModelMove` with no caller deadline: it waits for the step boundary for as long as the turn runs, hands over, and continues the turn. A terminal failure clears the pending pick and leaves a visible notice in the thread.
- Server start carries every thread that still holds a pending pick.
- The thread snapshot and list summaries show the pending pick as the thread's model, so every view, window and device shows the choice.
- The app's model write no longer waits on a carry; a send waits only for the write to answer.

**Acceptance.** Through `set_thread_model` on a native thread whose turn is running: the answer arrives before the turn reaches a step and its snapshot shows the new model; interrupting the caller changes nothing; the next turn — including a word queued after the pick — opens on the new road; the running turn stops at its next step `by: model` and continues on the new model even past 3 minutes; a pending pick survives a server restart and lands after it; a pick made while a compaction runs inside the turn never cuts that compaction — it finishes on the summarizer it was started with, and only at the boundary after it does the turn stop `by: model` and continue on the new model.
