---
id: 01a15120-d6f7-7dee-8d80-951a0f0e6f1e
title: Graph-to-file projection writes atomically, reads paths in one query, and walks the tree off the event loop
ord: 75
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15121-4481-7274-ae81-9b7f29d62547",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/tree/projection.ts
---
Graph-to-file projection (`apps/tagma/server/src/graph/tree/projection.ts`) writes and reads the tree so that a process crash can leave a corrupted file and a large graph holds the event loop.

- **Writing in place.** `writeFileSync(abs, text)` in the projection (around line 427) and in `restorePaths` (around line 506) writes straight into the working path, without temp+rename and fsync. A truncated file after a crash is then read by mirror repair — under [[7f692a1a]] it already once took a corrupted file as truth and deleted a block row.
- **N+1.** `encodedFiles` calls `pathOf` per row, and in the projection that is a separate `block.path` SELECT per block (line ~422).
- **Synchronous fs on the event loop.** `existsSync`/`readFileSync`/`statSync`/`readdirSync`/`rmSync` inside Effect generators; `restorePaths` recursively walks the tree, and every file is read whole for comparison with the new text. The cost grows with the graph without an upper bound — this is worker's work under [[7a910861]] (the tree already has `projection.worker.ts`).

Start by reading `projection.ts`, `mirror.ts`, and `projection.worker.ts` and the notes above them. Proof: atomic projection-file writes, one path query per projection, heavy walking off the event loop; existing tree tests green, a new test only if it guards the atomicity contract through a public operation.
