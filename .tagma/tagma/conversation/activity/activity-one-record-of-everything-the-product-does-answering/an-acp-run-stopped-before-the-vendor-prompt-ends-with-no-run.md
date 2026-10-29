---
id: 01a14e84-01a5-74fd-8e78-0f4ce92b448b
title: An ACP run stopped before the vendor prompt ends with no run activity
ord: 10
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14cfa-01b6-73d1-ab67-0e20a204ca15",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14e53-6096-7c4a-a466-3bfa8ffdfd41
  - kind: implements
    to: 01a111ad-1d14-7079-ad84-43a6a5fd6a10
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/activities.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/runs.ts
---
Review finding [[8ffdfd41]] (Sol). The activity `run` of an ACP turn is opened only by `ProtocolSteps.saved`, when the prompt is recorded (`plan.started`). If stop arrives earlier, `ProtocolRuns.interrupt` removes the not-yet-sent launch and closes the turn through `steps.close`, while `ProtocolActivities.end` with no open record writes nothing. The run exists in the ledger and ends `aborted`, but `read_thread` source `activity` shows neither its start, nor the process wait, nor the cancellation. Spec [[a5fd6a10]] requires one activity `run` per episode.

Make every ACP run own an activity `run` opened at launch, not at prompt recording. Proof — a system test: stop before the prompt yields one activity `run` with outcome `cancelled`.
