---
id: 01a1554e-6da7-7ec4-8ead-4daf77e3146e
title: A secondary-part failure never stops a thread run, and every server defect — survived or run-ending — is visible to the operator in the error list with a stack
ord: 85
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a0c6f0-27d3-71ea-90c2-b3debbed8039
  - kind: relates
    to: 01a14b75-1dfc-732d-bf66-797ec73a2739
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2abc2918809
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/FaultsButton.svelte
  - kind: file
    ref: packages/activity/src/Activity.ts
  - kind: file
    ref: packages/agent/src/agent/turn/call.ts
  - kind: symbol
    ref: packages/agent/src/agent/tool.ts
    symbol: toolPartialDisplay
---
A secondary part's failure never stops a thread's run, and every server defect — one survived and one that stopped a run — is visible to the operator in the error list with a stack.

**Why.** An Oct-19 regression in a running-call preview dropped every run where the model called `spawn_agent`: `toolPartialDisplay` returned a body of `undefined`, the body limit threw a `TypeError`, and it reached the step loop. Preview is presentation: the model answer, history, and tool effects do not depend on it. But any defect in the step ends the run (`AgentTurn.run` → `settle`). The stack stayed only in `serve.log`. The Errors button in the status bar collects only request failures of its own window and knows nothing of server defects. Besides, 536 `Effect.logWarning`/`logError` calls in agent, llm, and server take failures to the process log only; that is a call-count measurement, with expected conditions among them, not defects alone.

**What will stand.**

1. **A run's work divides into essential and secondary.**
   - Essential is what the answer, history, and effects depend on: parsing the model answer (`ResponseFold`), executing tools and writing their outcome, the journal, compaction, context accounting. Its defect still ends the run: continuing with the wrong history is worse than stopping.
   - Secondary is what the run gets the same result without. Its defect is survived by the run.

2. **One degradation combinator, in `@runlith/activity`.** `degraded(place, why, work, fallback)` turns `work`'s defect into `fallback` and puts a `degraded` note with place, message, and stack onto the current activity.
   - A typed failure and interruption pass through it: they are handled by condition.
   - `why` is required. That is the reasoned best-effort declaration [[ea465bed]] requires; the rule allowance stands once — on the combinator itself.
   - First users:
     - the running-call preview on both roads, `callModel` (`agent/turn/call.ts`) and `ThreadHosting.display`; on a defect the call line before the answer stays headerless;
     - the step-answer capture in `AgentTurn`: its failure now goes to `logWarning`, becomes `degraded`.
   - Other places where a defect is quenched into the log move to the combinator as work meets them. A `logWarning` of a typed, expected condition stays.

3. **A defect carries its stack.** An activity closed as a defect (`failed` / `Defect`) holds the stack beside the message, capped by the activity-body ceiling. A thread's run-failure record holds it too, and the "Turn failed" card copies it. That closes [[f07eeb40]].

4. **The error list reads the server.** The activity answers a defect projection over its storage window (`activity.keepHours`): activities closed as defects and `degraded` notes. The projection groups by fingerprint — place or shape plus message without variable parts — and gives count, first and last moment, last thread and run, last stack.
   - One owner outputs the fact ([[51c66cb6]]): no second store, no counting in the app.
   - The server serves the projection to the window as a live feed, and to an agent as an operation, from the same module that already serves activity reads.
   - The Errors button shows it in one list with window failures. A line: place, message, ×N, age, thread link, Copy (message, stack, thread, run).
   - After a window reload or server restart the list is the same while the fact is inside the activity window.
   - Clear is an operator mark on the server: no window shows what stood before it, and a repeated defect returns as a line.
   - The button shows while the list is non-empty.

5. **The compiler catches this error class.** A declaration's `display` projection takes a `Partial` of the schema fields: that is how streaming calls it, and the full preflight and hosted-road input assigns to that type. Reading a field that may be missing becomes a typecheck error in all 59 `display` declarations (34 files), not `undefined` in runtime. The `as (input: unknown) => ToolDisplay` cast in `toolPartialDisplay` leaves.

**What there is not.**
- A shared try/catch around the step: it would turn an essential-part defect into silently corrupted history.
- Auto-retry of a run after a fatal defect: the same code would fail again. Continuation is Continue after the fix.
- Toasts: a background failure goes to the error list per [[2a197ac2]].

**Acceptance.**
- A run holds a call whose preview projection throws or returns a non-string body. The run finishes, the tool executes, the pre-answer call line is headerless. The error list holds one line with place, stack, and thread link; after a window reload and a server restart it is still there.
- A defect in an essential part ends the run as a failure, as now. It is a line in the error list, and the stack is in the thread's failure card.
- Ten identical defects are one line ×10. Clear in one window removes it in all windows.
- A `display` reading an optional streaming-time field without a check fails `bun run typecheck`.
