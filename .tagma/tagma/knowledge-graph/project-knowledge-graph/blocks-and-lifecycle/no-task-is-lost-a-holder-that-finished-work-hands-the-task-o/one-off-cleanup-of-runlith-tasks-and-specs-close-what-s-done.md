---
id: 01a16527-352c-7185-bffb-405284526f99
title: "One-off cleanup of runlith tasks and specs: close what's done, list the rest for the operator"
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16527-9b68-761b-bfaf-2cee657e2350",
    "status": "in_work"
  }
---
Operator's decision of 2026-10-22. Check against the code, the graph and `git log`, and close without asking everything whose work is confirmed done:
- [[8f3e8091]], [[e8bb123d]];
- 9 specs with no open work: [[13bda205]], [[8d4a4eb8]], [[7df613b0]], [[508c4ca4]], [[d8ecdc6e]], [[c8d8b62b]], [[3c947db7]] — each by its own criteria, not by the empty task list;
- tasks in work held by idle holders ([[3fbcd691]], [[e645796e]], [[1f4a3bdb]], [[f314fb57]], [[355f1940]], [[1efba263]]): close what's done, release the rest to open or name them in the list.

For the remaining open tasks with no movement for over 3 days (116 of them on 2026-10-22) — a list for the operator: close / keep / ask, with a reason for each. Close only after his answer.
