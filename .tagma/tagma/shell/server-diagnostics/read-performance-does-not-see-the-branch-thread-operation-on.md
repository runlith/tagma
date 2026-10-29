---
id: 01a1469f-49e3-71b3-9289-c28572839a8a
title: "read_performance does not see the branch_thread operation: only bodies that wrote Effect.fn(id) themselves have an operation span"
ord: 7
tags: ["reflection"]
fields:
  {
    "actual": "total 0 and hours: [] — the operation has neither span nor metric. The branch_thread body in threads/operations/turns.ts is written via Effect.gen, ThreadBranch.fork — Effect.fnUntraced; an id span appears only at operations that named it themselves (read_thread, wait_command, read_output). The slow 12 s fork had to be reconstructed from the born id's UUIDv7, the native_thread row's created_at and updated_at, and SQLite reading.",
    "command": "read_performance({type: \"slow\", name: \"branch_thread\", since: 1792185510000, limit: 5}) and read_performance({type: \"metrics\", name: \"branch_thread\", since: 1792184400000, limit: 3})",
    "expected": "The branch_thread operation's span and hourly histogram: the performance skill promises that every Tagma operation's own span is named by its id and judged as a unit."
  }
---
Filed from project `runlith`.

The owner that must name an operation's span is the invocation layer (perform/executeById/performOperatorIn), once for all operations; now it is each body's voluntary choice, and operations without it are invisible to slow/metrics/breakdown.
