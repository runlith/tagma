---
id: 01a12c87-2e5e-734b-809d-0d14797472bd
title: glob breaks with a BadResource gap reading executionSpawner stdout
ord: 12
tags: ["reflection"]
fields:
  {
    "actual": "[glob] error: BadResource: executionSpawner.stdout: the record stopped answering: gap; no search results given.",
    "command": "glob({pattern:\"*\",path:\"/opt/workspaces/runlith\",limit:60})",
    "expected": "A page of paths and a file-search cursor."
  }
---
Filed from project `runlith`.
