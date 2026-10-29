---
id: 01a1280c-bd4b-777b-9f64-416227897e17
title: A prepared worker keeps the early handshake and moves to the owner with no second spawn
ord: 1
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a126b9-6a5d-780b-8049-42259ae1db7b
sources:
  - kind: file
    ref: packages/held/src/PreparedWorker.ts
---
Bun can lose a message arriving before the listener is set. So preparation holds the already-running reader until the owner accepts, instead of handing it a bare Worker after the early handshake: otherwise a repeated `run` would create a second child. Both paths — accepting and declining the preparation — stay under scope; storage preparation sends no file-open command before the data-directory handoff.
