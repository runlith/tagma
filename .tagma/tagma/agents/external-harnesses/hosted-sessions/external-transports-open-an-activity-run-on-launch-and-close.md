---
id: 01a1127b-7b73-7731-9eb1-d292631f7e48
title: External transports open an activity run on launch and close it on a known end; model steps stay unobserved
ord: 4
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a111c0-a6a5-7a73-8f4d-f9f410d560ac
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/activities.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/process.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/steps.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/terminal/journal.ts
---
ACP and the terminal transport share one `RunActivities`. The terminal opens a `run` after commit of the observed start, before printing the launch and on recovery. A named subscriber of the end obligation closes it with the kernel-recorded outcome, including displacement and LATE_STOP; usage is read from the run's committed row, where CLI requests and remainder already stand. Opening also reconciles the end against that row: Stop can record and deliver the outcome before the start's afterCommit creates the activity. So a separate request-publication stream does not define usage completeness, and an adapter request on completed does not substitute an accepted aborted. The ACP driver opens the activity `run` on turn launch (`ProtocolRuns.launch`, compaction — `compact`), before waiting on the process, so a turn stopped before the prompt also leaves one `run` with outcome `cancelled`; the step with the turn start opens it only if the launch did not (a recovered turn). Its `run` matches the `thread_run` id, actor is the executing thread, trigger is the ids of inbox items delivered to that run at launch, together with the launch seed. The record holds the driver area; the turn end completes the waiting fiber, and the combinator writes the outcome with the available CLI usage; a launch that failed before the turn closes it itself (`failed`, on interruption `aborted`). On the terminal, model and effort come only from attached CLI observations. On ACP, model and effort are what the turn asks of the agent (the thread's choice or the catalog default, as with session settings); without them — the last model reported by the CLI, otherwise `null`; `modelSteps: unobserved` distinguishes hidden internal calls from completeness of native-cycle observation. A turn recovered after a process change opens a new observed episode of the same run; the keeper closes the previous process's record separately.
