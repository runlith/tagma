---
id: 01a140f0-6f18-794d-b1bf-2fa2da78a2cc
title: "Deliver footnotes: an operator-notes rule with the readerInputs fact, a tail on the prompt channel for ACP lead and steer, retell:false, turns counted by turn opening"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a140f0-8a59-72e6-9e42-ed5155adfb77",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a140eb-0a34-75f6-93a0-7be91d74527f
  - kind: waits-on
    to: 01a140f0-6f18-794d-b1bf-2fa1740f15cd
---
Implements [[1d74527f]]. Waits for the set's owner. Done when the tests on recorded `runtime-guidance` frames from the spec pass on native and ACP, including the next run's history matching the previous request's prefix.
