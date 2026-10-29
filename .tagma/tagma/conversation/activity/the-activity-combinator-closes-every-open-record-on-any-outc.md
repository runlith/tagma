---
id: 01a1124a-1cc2-720e-b719-9bbb1b09b749
title: The activity combinator closes every open record on any outcome, including interruption, and puts only an in-memory fact on the producer fiber
ord: 18
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/activity/src/Activity.ts
  - kind: file
    ref: packages/agent/src/agent/ModelRequests.ts
  - kind: file
    ref: packages/llm/src/llm/route/notes.ts
---
`activity(kind, attrs, work, options)` opens and closes a record under an `uninterruptibleMask`: opening and `ended` run even if the fiber is interrupted between them, while only the work itself is interruptible. Without the mask, an interruption right after opening would have left the row open until the next start, where it would become `orphaned` although the process is alive. `activityStream` gives the same guarantee through the stream scope's `acquireRelease`.

The default outcome derives from `Exit`: success is `ok`, a typed failure is `failed` with its `_tag` and message, interruption alone is `cancelled`, a defect is `failed` with a `Defect` cause. The producer refines it in `ended(exit)` — for example, a refusal the work returned as success becomes `refused`. If `ended` throws, the `Exit` outcome stays, and an `ending-failed` note lands on the activity with the message: closing is not broken by producer code, nor does it hide that the refinement was lost.

Recording a fact on the producer fiber is O(1): `record` puts the fact into the writer's memory or the body into the body queue and wakes them. A body arrives as bytes its owner encoded once, so its size is known at admission: a body over the ceiling is rejected at once, and the queue is bounded by count and bytes. SQL runs in the store process, body files go to a worker. The combinator is therefore allowed on the cycle's hot path — on every tool call and model step.

`model-call` is opened only by `ModelRequests`, including a refused call with what was requested. The `@runlith/llm` transport writes the actual bytes after lowering once per HTTP execution; its status retries reference the same body through `http-started.body`, the body's local `n` in the activity. Re-entering transport on fold retry gets its own body, so a changed wire payload is stored under the same model call and tied to its attempts. The transport opens only notes; attempts get no activities of their own.
