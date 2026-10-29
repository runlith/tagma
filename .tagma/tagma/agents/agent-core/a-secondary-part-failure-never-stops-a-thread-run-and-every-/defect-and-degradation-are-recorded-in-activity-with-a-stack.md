---
id: 01a15554-aa13-720d-a2f3-b531b264cfb5
title: Defect and degradation are recorded in activity with a stack and fingerprint, while secondary run parts survive the defect
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1553e-fd52-722f-8a7a-7a31580932f1",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1554e-6da7-7ec4-8ead-4daf77e3146e
---
Parts 1–3 of spec [[77e3146e]]. `@runlith/activity`: a `defect` note on activity closing as a defect and through `defected`, a `degraded` combinator, an `ActivityFaults` projection (fingerprint read, Clear, change signal) over a `note` with a partial index. `packages/agent`: the running-call preview on both roads and step-answer capture go through `degraded`; an instrument defect that became the model answer and a defect that ended the run are written with `defected`; a run-failure record carries the stack. Proof — activity tests on the projection and a run surviving a thrown preview.
