---
id: 01a18a40-98ae-76e7-b1ee-79fa50f5e5bd
title: Judge merge dependencies against the resolved merge tree
ord: 151
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18a3c-f69c-7a56-adb0-3fe0ee170fbc",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a18745-8035-7554-91b6-fa5bb14d1306
---
Prepare an open merge using its resolved index as the dependency baseline, so declarations already brought by an incoming parent are not refused as uncommitted nobody's lines. Prove the native submit_work path in a registered worktree while preserving checks for declarations the merge does not carry.