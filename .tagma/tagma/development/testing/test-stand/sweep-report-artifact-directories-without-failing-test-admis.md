---
id: 01a19429-ae59-7046-9bf8-3d49e844c666
title: Sweep report artifact directories without failing test admission
ord: 30
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19421-dd94-70a8-8803-d52933fdfb4c",
    "status": "in_work"
  }
edges:
  - kind: relates
    to: 01a1941f-f2bb-77f3-9717-654e6b8cdc4b
  - kind: relates
    to: 01a1941f-f2bb-77f3-9717-6552f7c18c7c
---
A focused test run fails before Bun starts because testbed sweepRuns calls rmSync without recursive on a retained report artifact directory and receives EISDIR. Reproduce this report-directory shape through testbed's public run admission, correct cleanup at its owner while preserving report ownership and retention boundaries, and prove the focused test can start without manually deleting another run's directory.