---
id: 01a0f01e-4bd1-7f3a-b3a2-8788bd12712a
title: Split packages/trace-bundle's files over 650 non-import lines by subject
ord: 17
tags: ["task"]
fields:
  {
    "status": "closed"
  }
---
Rule [[6b3210c7]] carries each file below as debt at its current size, which it may shrink from but never exceed. Split each by the subjects it holds, each new file named for its subject; a cut at a line count is not a split. A file that reaches 650 or fewer retires its debt entry.

- `packages/trace-bundle/src/TraceBundles.ts` — 666
- `packages/trace-bundle/src/replay.ts` — 691