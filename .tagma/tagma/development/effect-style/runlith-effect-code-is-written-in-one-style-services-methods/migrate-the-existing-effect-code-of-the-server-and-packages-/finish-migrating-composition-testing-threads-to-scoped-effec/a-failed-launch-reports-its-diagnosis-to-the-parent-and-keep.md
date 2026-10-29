---
id: 01a14cf4-82e0-7b90-9aca-80c29ff7ad36
title: A failed launch reports its diagnosis to the parent and keeps the task queued
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c19-2ae6-7c7d-9cc2-edc404b6eb7f",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14c18-c833-7d88-b3bd-66eb312abbba
sources:
  - kind: file
    ref: packages/agent/src/collaboration/reporting.ts
  - kind: file
    ref: packages/agent/src/thread/run/lifecycle/closing.ts
---
When an ACP launch fails over a disconnected directory account, the run ends failed/unknown-account and gets settledNotifiedAt, but the parent gets no report: the inbox return clears the task's link to the run before its notification forms. Keep the exact ids of the requests returned by this launch in its end event and use them in the diagnostic report, without grabbing unrelated waiting tasks or reporting for unconfirmed words. The fix belongs to the agent package's closing/reporting owners; proof is the existing public protocolRuns refused-account case from red to green, plus checks of ordinary reports and unread words. This result belongs to the single reviewer's review of the whole parent work.
