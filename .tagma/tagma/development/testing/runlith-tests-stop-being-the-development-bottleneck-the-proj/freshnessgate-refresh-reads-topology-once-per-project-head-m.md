---
id: 01a16e56-327d-7371-8844-5b73f9685188
title: "FreshnessGate.refresh reads topology once per project HEAD movement: the git project's rename events do not count as loss"
ord: 36
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16ded-dc27-77a1-99da-993a426871ff",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16ac4-44bf-7e0a-8178-b6ff38ef1770
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/serving/freshness.ts
  - kind: file
    ref: apps/tagma/server/src/graph/tree/topology.ts
---
Landing a native submit_work ran ~10 git in the graph's FreshnessGate.refresh: two refreshes per commit, each a full status of the graph tree plus a topology read (for-each-ref ×3, worktree list).

Cause at the producer: git writes the project's `refs/heads/*`, `logs/HEAD`, and `index` through lock and rename, the watcher delivers that as `rescan: 'rename'` with a named path, and `heard` treated any rescan as event loss — dropping the narrowed scope (tree-wide status) and marking topology stale, including from the project's `index`, which the stealth-graph tree never reads. Two events of one commit (refs and logs/HEAD) produced a second refresh with the same read.

Cut: for a twin tree, a named rename event of the project's `head`/`refs` is the same topology movement as a plain `head`; the project's `index` never wakes a refresh; a topology event that arrives before a running refresh has read topology is covered by that refresh. `readTopology` does not list the worktree when only the readable checkout is remembered, and does not ask `--merged HEAD` when no other branch with a twin can turn out merged.
