---
id: 01a0c465-286c-7a44-9769-dcfabdd849e6
title: Settle a parked approval when its invocation is stopped
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c3ae-c034-768e-bc07-ec06ea4dd607",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c3c3-7916-729c-a148-d546b2793096
  - kind: implements
    to: 01a0c3c3-5cae-7cce-af4b-00c64ef45bc7
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/calls/activity.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadInteraction.ts
  - kind: file
    ref: packages/agent/src/thread/run/ToolQuestion.ts
---
Connect per-invocation stop and deadline expiry to the native question owner: stopping a call parked for approval currently ends its activity record and prevents execution, but does not itself answer the pending question and resume the model. Settle the selected call without executing it or granting consent; preserve other calls in a grouped question. Prove that a sole cancelled approval resumes the same run and that cancelling one grouped call leaves the other approvals intact.