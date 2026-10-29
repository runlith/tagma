---
id: 01a12bdb-e470-7060-9bd0-638bb70cac5f
title: grep stops the search with BadResource executionSpawner.stdout
ord: 6
tags: ["reflection"]
fields:
  {
    "actual": "[grep] error: BadResource: executionSpawner.stdout: the record stopped answering: gap. One call gave no results.",
    "command": "grep {pattern:\"tagma\",path:\"/opt/workspaces/runlith/packages/\",limit:60}",
    "expected": "The search returns tagma matches."
  }
---
Filed from project `runlith`.
