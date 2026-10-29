---
id: 01a17420-82f5-7fc3-a9bf-164bdb32beea
title: "A send_task assignment is work in the graph: taking it shows in the graph, and its end is the report to the parent"
ord: 38
tags: ["idea"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-693cdef49593
---
Tagma holds two work registries today that know nothing of each other: a `send_task` assignment — a thread-inbox row — and a graph `#task` node with a holder. Taking a task wakes nobody, a task's end never becomes the report, and a coordinator's plan lives only in his transcript (at Paperclip work is an issue record, at Tagma a conversation).

The idea: an assignment is born as graph work (or references existing work), the child holds it, and its end with a commit is the parent's final answer. Then after the coordinator's compaction the assignment plan and state read from the graph, and the operator sees the team in the same nodes as the work.

Decide: whether graph work is required for every assignment or only those naming it; how to handle projects without holder-carrying tags; what remains of the letter-report when the work's end already says "done". The decision changes the delegation model — it is the operator's word.
