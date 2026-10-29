---
id: 01a0f01e-4bca-7d3b-902f-e8794736a250
title: Split packages/executions's files over 650 non-import lines by subject
ord: 40
tags: ["task"]
fields:
  {
    "status": "closed"
  }
---
Rule [[6b3210c7]] carries each file below as debt at its current size, which it may shrink from but never exceed. Split each by the subjects it holds, each new file named for its subject; a cut at a line count is not a split. A file that reaches 650 or fewer retires its debt entry.

- `packages/executions/src/executionSpawner.ts` — 654
- `packages/executions/src/protocol/wire.ts` — 738