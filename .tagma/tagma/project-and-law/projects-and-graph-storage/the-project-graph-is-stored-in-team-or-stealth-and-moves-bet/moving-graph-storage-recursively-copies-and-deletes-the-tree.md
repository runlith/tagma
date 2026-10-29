---
id: 01a15134-0b9f-7e2c-809e-ec1c0b639d55
title: Moving graph storage recursively copies and deletes the tree on the server loop
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15136-49be-7da5-887d-c66410d059d4",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15120-d727-72aa-b665-acc0f13fcc59
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/storage/move.ts
---
Remove the growing synchronous file walk from the graph storage move's server request, keeping the tree, the occupied-target bans, and mid-merge. Owner is graph/storage; serving owns the project move's lifetime.

Result: root traversal, cross-device copy, and tree deletion are done by async FileSystem. The move uses the already-read source list; copy engages only on EXDEV, source is deleted after successful copying. The move holds the project permit until the policy switch and the target open; started opens finish before it, new opens during it get a typed refusal. The move after entry isn't interrupted mid-file-operation. Its contract explains [[3e562c8b|the project ownership invariant]].

Verified by the public roundtrip pool.moveProjectStorage: EXDEV simulated on the existing FileSystem port, the tree and copying themselves real; ids, bodies, and new records kept after the move, unrelated workflows, and refusals on occupied targets. While completed copy waits for source deletion, machine policy reads, and reopen refuses. This regression went red→green: before the fix, the independent review's single P1 returned a successful reopen. The assembled check moved from integration to system, fits in 60 seconds per file. Whole-delivery review: [[01a15142-316c-7442-9c63-acbe43725f62|fs-graph-review]], one round, finding fixed.

Last joint public run with platformsDeclared.itest: 3 pass, 33 assertions, 18.1 seconds. Bun run typecheck finished exit 0, the server — 5,088 files without errors. The same reviewer's final reading of the new second-step implementation gave no new findings. Real EXDEV across volumes and latency on a large graph weren't measured. The running server wasn't restarted.
