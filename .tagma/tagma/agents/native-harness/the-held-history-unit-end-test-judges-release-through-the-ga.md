---
id: 01a1b1be-3023-7f52-873f-dc54eb5998d8
title: The held-history unit-end test judges release through the garbage collector instead of its owner's own fact
ord: 75
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19eb2-4a56-79d0-9dbd-af67ec98a662",
    "status": "in_work"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/transcript/history.itest.ts
---
`apps/tagma/server/src/native-harness/transcript/history.itest.ts` — "a history folded inside a unit leaves memory when the unit ends, though something still holds the unit" — asserts that `WeakRef` targets are gone after `Bun.gc(true)`. JSC's collector scans stacks conservatively, so whether a dead history is collected in that pass is not the owner's fact; the test failed once on the macOS runner (integration run 42249503962, `written.deref()` still alive) and passes locally.

The owner's fact is that `atUnitEnd` drops the unit's entry from `foldsByUnit` and that a claim ending without settle restores or drops the held entry. Rewrite the test to judge that through the owner's public reads (what a later reader gets, what `HeldHistories` still holds and weighs), or delete it if no public read can tell the two apart.