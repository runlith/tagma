---
id: 01a19405-bf84-70bf-a4dd-0af83fa2b6e2
title: Classify merge continuation as committing into another checkout
ord: 10
tags: ["task"]
fields:
  {
    "holder": "tagma:01a193f6-f75f-7249-8b8f-36444a9361c0",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a127d7-64ed-72f9-982c-b4fead143626
---
shellCommitDirs now recognizes the literal git merge --continue form as committing, so BashTool.commitElsewhere raises the existing commit-elsewhere condition for another registered checkout. Approval declarations, thresholds, settings and the separate same-checkout sweep classification are unchanged. The public bash preparation regression first received [] instead of [commit-elsewhere] for a resolved merge in a real linked worktree; it now classifies git commit --no-edit and the continuation alike, then runs the continuation and verifies two parents and cleared MERGE_HEAD. bash.itest.ts passes 37/37 and shellShapes.test.ts 90/90 on seeds 1, 2 and 3, with package typecheck green. The claim that no own merge-finishing door exists is obsolete: submit_work builds resolved merges with their parents and concludes their state. The original historical no-approver circumstances were not replayed; approval-availability routing was not changed. No live product launch or wide test suite was run.