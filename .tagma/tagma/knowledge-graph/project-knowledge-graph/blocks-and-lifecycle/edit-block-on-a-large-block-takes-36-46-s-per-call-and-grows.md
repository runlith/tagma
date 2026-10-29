---
id: 01a0e3b5-0899-7727-b5ac-a3e4ac005006
title: edit_block on a large block takes 36–46 s per call and grows with each successive edit of the same block
ord: 24
tags: ["reflection"]
fields:
  {
    "actual": "Successive one-character-delta edits took 36.5, 37.7, 39.3, 41.3, 43.9, 46.0 s (\"body 173901 → 173900 · refs 4\"), rising with every edit of the same block while the machine was loaded by ~15 concurrent agents.",
    "command": "edit_block on decision f658e190 (body ~174 KB), repeated one-occurrence renames by the spec-data agent, 2026-09-27 ~16:30",
    "expected": "An edit costs what it changes: a one-word replacement in a large body answers in milliseconds to well under a second, and the Nth edit costs the same as the first."
  }
---
Filed from project `runlith`.

Suspects to measure: whole-body rewrite and whole-file projection per act, history/diff storage that grows per version, search re-index of the full body, reference scan, re-measure of the block's sources, tree permit and writer waits under load. The rising series points at something proportional to the block's history rather than to load alone. The target-architecture spec's section 3 performance addendum is asked to make graph acts cost proportional to their delta.