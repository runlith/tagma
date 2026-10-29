---
id: 01a123d1-efb6-71d1-a97d-0dbe4da01bb2
title: "Stage 3 acceptance: a read-only Linear bridge on a schedule with a secret"
ord: 9
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12395-c3c5-763e-8ec3-0b0e9e3b0f71",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1227f-7522-78e3-a658-79b7a0a16218
sources:
  - kind: dir
    ref: .plugins/linear
---
Create `.plugins/linear`: a periodic poll of Linear GraphQL on a schedule with the LINEAR_API_KEY via secrets, a notification of new tasks, and an agents tool for the latest tasks. Only the plugin's package changes; a lacking Tagma contract stops the work naming the owner. Verify on a separate Tagma instance against a local GraphQL fixture: one tick and one notification of a new task, no crash-loop without the key and no key leak, schedule teardown, surviving life after the window closes, project deletion, and process restart. No real key; the operator connects to Linear after entering it. The delivery includes one Sol xhigh review round, a commit, and stopping its own instance.
