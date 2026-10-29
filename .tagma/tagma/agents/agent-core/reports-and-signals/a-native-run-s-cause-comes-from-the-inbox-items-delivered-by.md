---
id: 01a1127b-7b7a-74c0-94d5-e084ccf46cba
title: A native run's cause comes from the inbox items delivered by its start; start_key only holds idempotency
ord: 3
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a111c0-a6a5-7a73-8f4d-f9f410d560ac
sources:
  - kind: file
    ref: packages/agent/src/thread/run/runCause.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadRunStarter.ts
  - kind: file
    ref: packages/agent/src/thread/storage/inbox.ts
---
At native-loop start the cause is taken from the inbox `deliveredToRunId`, whether the item stayed delivered or is already acknowledged. That snapshot of ids becomes the trigger `{kind: inbox, refs}` via `ActivityCause`; later words do not change the opened cause. When the snapshot is empty, the cause is whatever opened the run in its journal. The operator's words are also kept into the inbox as the first act, so a turn they open is `{kind: inbox}` with their entry's id. A turn with no inbox entries but a user message yields `{kind: turn, refs: [message:user:<run>]}`, and a keep-warm run yields `{kind: keep-warm, refs: [signal]}`. When there is neither, there is no trigger: an operation retry key is not issued for input the agent received. A run's actor is the thread executing the work, not each item's sender.
