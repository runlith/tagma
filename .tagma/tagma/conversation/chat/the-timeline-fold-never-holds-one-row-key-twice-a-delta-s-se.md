---
id: 01a1859b-7556-760e-bc99-31f32c28eff8
title: "The timeline fold never holds one row key twice: a delta's settled steps leave the live tail before its body rows land"
ord: 85
tags: ["explanation"]
sources:
  - kind: symbol
    ref: packages/chat-ui/src/TimelineFold.ts
    symbol: TimelineFold
---
The fold's row list is a keyed `ChunkedList`, which indexes one chunk per key: a key held twice across chunks loses its index once either copy leaves, and the next change to that row's segment finds it at -1 and fails the whole transcript.

A step that settles keeps its key (the entry id) from the live tail into the body, so the row and its measured height carry over. The body follows each feed delta at once while the tail is rebuilt only when the fold settles, so within one sync a step could stand in both places. One feed delta may also coalesce several source batches, so a step can leave the live set and come back within it while its intermediate body row is still among the delta's row changes. `take` therefore applies a delta's live changes first and, before landing its body rows, drops from the tail every step that left the live set or whose key any of the delta's row splices inserts; the tail regains its steps only at settle, after the body rows are final. Dropping by final live membership alone, or landing body rows before the drop, brings the double key back.
