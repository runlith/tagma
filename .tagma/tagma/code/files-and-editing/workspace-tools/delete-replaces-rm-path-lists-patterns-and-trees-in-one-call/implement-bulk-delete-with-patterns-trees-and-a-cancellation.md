---
id: 01a15ee7-c1c3-73b8-979c-202032fdab8a
title: Implement bulk delete with patterns, trees, and a cancellation-safe outcome
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15ebd-abe8-71e6-991d-ce9a73c9807b",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15eda-f791-7c2a-a727-532dfe9afd88
  - kind: relates
    to: 01a15ec4-b364-7b29-bbdf-7c9be2296e2b
---
Implemented delete with rm argv, lists, globs, and trees, exact authorship, partial outcomes, and a cancellation-safe file report. Updated own callers and instructions. One independent review found three confirmed defects: losing the chosen identity when reading text, losing the ready answer when stopping the projection, and late normalization read after Git metadata removal; all fixed at owners and verified with public regressions. Key file, intake, retention, and cancellation suites are green; the final door suite is 82 tests. The last shared typecheck reported 17 errors in eight neighbouring test files of parallel work, with no errors in delete's changed files. A full one-off smoke on this machine deleted 100 and 1000 files cleanly in 1618.7 and 1786.57 ms; process high-water RSS 51632 and 70880 KiB, not a universal SLO. This measurement's temp fixtures are deleted, the command is kept in the thread. Real Windows and privileged mount scenarios were not run here; device contracts were verified via FileSystem. The running server was not restarted.
