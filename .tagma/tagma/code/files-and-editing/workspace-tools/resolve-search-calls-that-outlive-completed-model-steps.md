---
id: 01a1941f-f2bb-77f3-9717-654a87706e46
title: Resolve search calls that outlive completed model steps
ord: 146
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a0c97f-58ae-7ce0-825b-36dfe9f93dfe
  - kind: relates
    to: 01a12c87-608b-711a-bf63-fd5368e2e88a
---
Identify the initiating search/execution wait behind the original pending calls before changing its producer. In thread 01a0c957-cae2-77e0-ab6a-38b3310ee6fa, model step 13 completed (141/147), while grep 143 remained pending for 40m37.653s until stop outcome 150; in thread 01a0c964-6c84-7e27-aded-2fb0f6a8b2ae, step 25 completed (161/163), while grep 162 remained pending for 27m14.454s until stop outcome 164. These records refute a hung model request.

Historical search recovery was repaired by 02ece96baa (a first-outcome race instead of a race that held early failures) and ac47d94ddb (ending the child separately from an uninterruptible spawner finalizer). The current ripgrep stream retains interruption and the stop ladder. Current public grep calls over the retained /opt/workspaces/runlith tree at c5a73cbc7e, using the original patterns and content mode, completed: compaction returned 15 matches in 6 files; browser-safe|browserSafe|browser returned 9,579 matches in 1,035 files. The focused filePages.itest.ts and search.itest.ts run passed 13 tests, including child cancellation, with exit 0.

The original native execution/pipe state and running source revision are not carried by the addressed tool records, so the initiating hang is not established as a current defect. Keep this task and the reflection open: no new source fix or deadline change is justified by the checked scenarios. Reproduction needs an execution-linked occurrence or a controlled peer reproducing an identified wait, not a generic silent model.