---
id: 01a14bc0-768b-7e96-9c80-5cff98b2fb74
title: "Activity record answers what the product did to a thread over the last day: who, why, with which model, on which input, and with what effect"
ord: 10
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14be4-2437-75af-92bd-b427b7bf6486
sources:
  - kind: file
    ref: apps/tagma/server/src/activity/contract/wire/settings.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/evidence/activity.ts
  - kind: file
    ref: apps/tagma/server/src/threads/cli/threadVerbs.ts
  - kind: file
    ref: packages/activity/src/store/ActivityStore.ts
  - kind: file
    ref: packages/activity/src/store/upkeep.ts
---
**Value.** The question "what happened here and why" about a thread over the last day is answered by one record: who acted, for what reason, with which model, on which input, and with what effect.

**How.** The `tagma activity` terminal; the `read_thread` (activity selection), `read_thread_record`, and `list_threads` operations with an activity window. Retention and body storage live in Settings → Activity.

**Behaviour.**
- Runs, model calls with usage, tool calls, compactions, child reports, thread naming, and recaps are written; each entry carries actor, trigger, parent, and outcome.
- Bodies lie beside them — bytes to and from the provider, tool arguments and results as the model saw them.
- A record left open by a stopped server is closed as orphaned by the next start. Lost facts are named by the reading and never claim to be complete.

**Limits.** Past retention, entries leave; over budget, old bodies leave first. The record neither slows nor drops the work it observes.
