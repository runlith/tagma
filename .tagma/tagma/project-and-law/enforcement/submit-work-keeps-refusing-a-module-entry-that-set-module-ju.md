---
id: 01a1858f-611f-731a-9695-11329c942a41
title: submit_work keeps refusing a module entry that set_module just opened
ord: 166
tags: ["reflection"]
fields:
  {
    "actual": "submit_work refused rule-violated 083d37f1 with the same fix text (\"open one covering packages/file-lock/src/flock.ts with set_module\") right after set_module succeeded; sync_graph refuses not-a-team-tree, so no exit remained and the work landed by plain git commit",
    "command": "set_module {modules:[{id:\"@runlith/file-lock\", entries:{put:[{at:\"src/flock.ts\", for:[…, \"a287d79f\"]}]}}]} then submit_work {paths:[\"packages/e2e/src/lanes/ios.ts\",\"packages/e2e/src/lanes/simulator.ts\"]} in worktree feed-e2e",
    "expected": "After set_module opens src/flock.ts to @runlith/e2e (re-measured 083d37f1 at b26166ee, debt 0), submit_work's 083d37f1 gate accepts simulator.ts importing @runlith/file-lock/flock"
  }
---
Filed from project `tagma`.