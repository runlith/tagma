---
id: 01a16df4-b87d-723d-a303-36e88bfc4422
title: The missing deletion is explained by a stale fsmonitor; the file stays deleted
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "The file is physically missing; plain git status is empty, with core.fsmonitor=false it prints D. read_changes wrongly closed the deletion as withdrawn (reverted).",
    "command": "git -c core.fsmonitor=false status --short -- apps/tagma/server/src/installation/closure/workers.itest.ts",
    "expected": "read_changes and git status with fsmonitor see the same deletion as the file's physical state."
  }
---
The file is physically gone; plain git status is empty, while with `core.fsmonitor=false` it prints D. read_changes wrongly closed the deletion as withdrawn (reverted).

The first record assumed the file was restored; a direct test -e returned exists=1 (missing), and a repeated delete refused not-found. `git -c core.fsmonitor=false diff --name-status HEAD --` confirmed D for the file. So the deletions were never rolled back: the attribution mechanism trusted a stale fsmonitor status and lost ownership.
