---
id: 01a15149-31c7-7e1f-b8f9-42ab3e562c8b
title: "A storage move is exclusive for the project in the pool: an opening begun mid-move waits for its end and opens the new place"
ord: 5
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/serving/checkout.ts
    symbol: makeServingSwitch
  - kind: symbol
    ref: apps/tagma/server/src/graph/serving/copies.ts
    symbol: makeCopies
  - kind: symbol
    ref: apps/tagma/server/src/graph/serving/pool.ts
    symbol: makeGraphPool
---
One tree gate is not enough: after the source tree is released the policy still points at it, and a fresh opening could confirm a write into an already copied file before the source is deleted. So a move, like project birth and removal, goes through one project state in the pool: it raises the "moving" mark, awaits the project's already started openings, moves, and drops the mark.

An opening started before the mark finishes before the move and closes with the project's copies; an opening after the mark awaits its removal and picks the place anew. While the mark stands, no ready project copy is handed out, and an opening registers in the same synchronous step in which it saw no mark — so the move misses no opening and never starves under continuous calls.

The move is uninterrupted between file operations and the policy change, and the act itself opens the target for the first time. Its own opening and copy teardown run as internal: they never await the mark and never register among the awaited, or the act would wait for itself.
