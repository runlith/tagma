---
id: 01a16ea0-533e-7a5c-a3db-3dbc59427f18
title: "Copy into just-cleared space goes with overwrite: without it Bun copies by the slow path"
ord: 154
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/graphFixture.ts
  - kind: file
    ref: apps/tagma/server/src/executions/host/offer.ts
  - kind: file
    ref: apps/tagma/server/src/graph/serving/open.ts
  - kind: file
    ref: apps/tagma/server/src/graph/storage/move.ts
  - kind: file
    ref: apps/tagma/server/src/installation/cut/publish.ts
  - kind: file
    ref: apps/tagma/server/src/installation/cut/stage.ts
---
Effect `FileSystem.copy` without `overwrite` calls `fs.cp` with `force: false`, and Bun 1.4.3 then walks the tree with its own JS traversal: 15–17 ms CPU on a fresh git directory of 41 entries versus 1.3–1.6 ms with `force: true` (one measurement on M2 Max). When the destination was just deleted or created, the copy result does not depend on the flag, so such copies — the host bundle into `bundle.own`, work-tree records when aligning shape, the graph store EXDEV move, release maps and inputs — pass `overwrite: true`.

Where the destination may legitimately exist, the flag is not set: `force: false` silently leaves the existing file, `force: true` replaces it and can fail on permissions where the old copy passed. A file-versus-directory conflict refuses under either flag.
