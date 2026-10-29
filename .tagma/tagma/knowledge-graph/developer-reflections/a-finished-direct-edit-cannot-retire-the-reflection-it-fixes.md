---
id: 01a0de55-bda2-74ed-99d1-14c1a894be64
title: A finished direct edit cannot retire the reflection it fixes without inventing a task
ord: 5
tags: ["reflection"]
fields:
  {
    "actual": "All five remain unanswered after their fixes landed and their code/claims were checked. answer_reflection accepts previously completed work or an existing doc/rule; newly finished tracked work can answer through discovered-from, but a direct edit has no answering block. The catalog says a small determined edit needs no task solely to record a commit.",
    "command": "read_reflections after direct fixes of fc359b52, 050eebe9, 4848d6fb, 64bd0a57 and 517bd60e; inspect answer_reflection contract",
    "expected": "A reflection fixed by a verified direct code edit and its commit can be answered with that evidence, without creating a #task merely to mark the fix."
  }
---
Filed from project `runlith`.

Five fixed cases remain in the same queue as live defects. Re-reviewing them costs a graph read and can lead to a duplicate fix; creating retroactive tasks only to make the queue shrink would violate the task catalog. A direct-edit resolution needs its own evidence-bearing road, or the queue must distinguish fixed-but-unanswerable observations from outstanding ones.