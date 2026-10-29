---
id: 01a12c91-8bc9-74d5-b622-8a8ee33ea948
title: glob ends again with a gap on stdout
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "The same call returned [glob] error: BadResource: executionSpawner.stdout: the record stopped answering: gap again; no listing and no execution ref.",
    "command": "glob({pattern:\"*\",path:\"/opt/workspaces/runlith\",limit:60})",
    "expected": "A page of paths and a cursor."
  }
---
Filed from project `runlith`.
