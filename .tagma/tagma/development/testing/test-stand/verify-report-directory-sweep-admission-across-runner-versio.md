---
id: 01a19429-ae59-7046-9bf8-3d49e844c666
title: Verify report-directory sweep admission across runner versions
ord: 30
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19421-dd94-70a8-8803-d52933fdfb4c",
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a1941f-f2bb-77f3-9717-654e6b8cdc4b
  - kind: relates
    to: 01a1941f-f2bb-77f3-9717-6552f7c18c7c
---
The EISDIR incident ran testbed at the older core revision `a46d91d1964ef4e4eb377d19666b189a46726a42`: `sweepRuns` selected report directories and passed them to nonrecursive `rmSync`. The existing fix `17e252251c2cb2041c7ebe0d2dc8de074fb07d31` excludes non-files; current main also selects `.jsonl` files and claims associated artifact directories by rename before recursive removal. Source and ancestry were checked directly. Current-runner admission completed for the activity-window probe and reached test bodies for the graph-queue probe, without removing another run's retained directory manually. The original caller's focused offline probe also passed with the current runner. No new source fix, pin change, cleanup bypass or repeat green run was needed.