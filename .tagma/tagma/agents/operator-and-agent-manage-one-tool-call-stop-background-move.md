---
id: 01a14b6d-b272-7b0a-96ae-43eb549b6a54
title: Operator and agent manage one tool call — stop, background, move the deadline — without touching the run
ord: 31
---
The operator or the agent itself decides the fate of one stuck or long tool call without stopping the whole turn: stop just that call, release the model's wait into the background, or move its deadline.

**How.** `read_calls` — a live record of the calls the project holds now: what each does, whose thread it is, and what it was asked about; running first, then finished. `control_call` on a `runId` + `toolCallId` pair: `stop` — end that call and what it holds, the model gets it as its own call's outcome and decides next; `background` — release the model's wait without cancelling the work: the call now belongs to the thread, and its result reaches the thread as a notification (and after a restart); `limit` — a new total deadline from the call's admission, with no time for the question and queue. `wait_call` waits for the call's end within the named budget (the budget bounds the wait, not the work); the operator's words and a due report cut the wait short. In the app — call controls in the feed.

**Limits.** The operator reaches any call of its project, a thread — only calls of its own thread; someone else's, unknown, and already gone pairs answer identically — `unknown-invocation`. `background` is available only to a call that already entered execution, and does not bypass a missing permission. A restart keeps only what is due: background calls whose result has not arrived yet — as `interrupted`.

Code: apps/tagma/server/src/native-harness/contract/wire/operations/calls.ts#CALL_OPERATIONS, apps/tagma/server/src/native-harness/operations/calls.ts, packages/agent/src/callProgress.ts, apps/tagma/app/src/lib/features/threads/CallControls.svelte
