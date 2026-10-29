---
id: 01a17a8f-895f-7d22-bd87-03cc5360ea0b
title: The Bun --no-orphans guard belongs to the runner, not the programs the test checks
ord: 14
tags: ["explanation"]
sources:
  - kind: symbol
    ref: packages/testbed/src/core/run.ts
    symbol: openRun
---
Bun carries `--no-orphans` into the environment as `BUN_FEATURE_FLAG_NO_ORPHANS=1`; every child Bun otherwise kills its own descendants on exit. That changed the lifetime of checked hosts, holders and servers and hid leftovers from the guard. When a run opens, the stand drops the inherited startup flag before preparing resources and the file environment snapshot. An already started runner keeps its native exit guard, and programs started by the test get usual lifetime; a `--no-orphans` argument explicitly passed to a program stays that program's own choice.
