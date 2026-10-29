---
id: 01a13258-1033-70a1-89fa-2141c7d9b5b3
title: "delete_thread in the native tool takes no project: another project's thread deletes only via CLI"
ord: 93
tags: ["reflection"]
fields:
  {
    "actual": "refused foreign-project \"read it with project: 25\", but the delete_thread schema has no project field; only `tagma op delete_thread --project fluent` worked",
    "command": "delete_thread {threadId} for a thread of project 25 from a thread of project 5",
    "expected": "The tool schema takes project, like list_threads, and the thread is deleted"
  }
---
Filed from project `runlith`.