---
id: 01a0f01e-4bb3-714e-983c-373c12f0c2d1
title: Split apps/tagma/inspection's files over 650 non-import lines by subject
ord: 15
tags: ["task"]
fields:
  {
    "status": "closed"
  }
---
Rule [[6b3210c7]] carries each file below as debt at its current size, which it may shrink from but never exceed. Split each by the subjects it holds, each new file named for its subject; a cut at a line count is not a split. A file that reaches 650 or fewer retires its debt entry.

- `apps/tagma/inspection/src/core/node/run.ts` — 660