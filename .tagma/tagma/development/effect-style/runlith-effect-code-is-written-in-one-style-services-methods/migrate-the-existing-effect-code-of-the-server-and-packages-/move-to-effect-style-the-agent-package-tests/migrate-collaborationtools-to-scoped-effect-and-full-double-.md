---
id: 01a14044-9134-7764-9de3-4f32bd1032e5
title: Migrate CollaborationTools to scoped Effect and full double contracts
ord: 32
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13db8-6291-708d-abe5-d21ebd6a6d17",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13d30-d804-7b33-9b8b-12527b27377d
sources:
  - kind: file
    ref: packages/agent/src/collaboration/CollaborationTools.test.ts
---
Migrate `collaboration/CollaborationTools.test.ts` to `@runlith/effect-test`: keep tool-facing answers, agreements, addressee routing, model inheritance and keyed replay; replace the local runtime with scoped Effect and full tagged faces with memory storage. Remove only copy, smoke and duplicate checks with no distinguishable state. Completion is confirmed by the file's serial test, file-scoped typecheck, effect-style/law, one Sol+Muse review and the landed diff.
