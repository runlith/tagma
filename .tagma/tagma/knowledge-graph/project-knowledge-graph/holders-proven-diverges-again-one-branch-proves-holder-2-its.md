---
id: 01a1780e-6fd1-7438-908a-6d24e302d54f
title: "holders_proven diverges again: one branch proves holder 2, its sibling and release drop it"
ord: 246
tags: ["reflection"]
fields:
  {
    "actual": "`feature-a` (247fbfc9) wrote holder tagma:01a1205b-860f-7204-8ede-30bea586c5d8 in two block files; `feature-c` (4433451a) and release (396d3727) deleted it; both merges conflict on exactly those two files",
    "command": "graph merge `feature-a` → `feature-c` (recovery 80697592-321a-4e62-a390-b0ae41ac33da) and `feature-a` → `feature-b` (recovery 1741f680-dcad-4ffa-ba0a-0bbb51231f79)",
    "expected": "The same graph step over holder 2 writes the same value on every branch, so these merges carry no holder conflict"
  }
---
This shows the step's output depends on which branch's checkout runs it, not on the base data: holder 2 counted as unprovable for the `feature-c` and release runs and as provable for the `feature-a` run. The `feature-b` recovery also conflicts in tags/rule.md and tags/software-development.md (not examined here). The banner on the thread "Graph recovery: feature-c → release" shows feature-a → feature-c after that recovery was published, which reads as if the finished recovery failed.