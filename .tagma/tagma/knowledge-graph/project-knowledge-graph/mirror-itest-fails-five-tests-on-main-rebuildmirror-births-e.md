---
id: 01a1355a-9901-71c2-bc35-e4f72a68f5ef
title: "mirror.itest fails five tests on main: rebuildMirror births extra blocks, repair does not delete the deleted file"
ord: 40
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1355a-dec8-70e8-8b95-296791cfe142",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1353a-0457-7605-8cda-2760c4814df0
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/graph/tree/mirror.itest.ts
  - kind: file
    ref: apps/tagma/server/src/graph/tree/mirror.ts
---
`composition/testing/graph/tree/mirror.itest.ts` on main (13.10 ~15:00, after 2f53f692b5) fails 5 of 13 tests; no uncommitted rows under `apps/tagma/server/src/graph` from anyone.

- "rebuilt rows answer through ranking…": `rebuildMirror` returns two extra ids, freshly created (`01a13559-…`), beyond the tree blocks and three tag declarations — something at mirror assembly seems to birth blocks.
- "an arriving foreign identity resolves the reference…": the dead reference is not open after rebuild (`deadRefIsOpen` → false).
- "the incremental repair upserts, moves and removes exactly the delta…": after `repairMirror` with `doctrine/newcomer.md` deleted, block D stays.
- "a mirror born empty numbers by uuid order…": two assemblies give different numbering.
- one unnamed test — 8.2 s, likely a timeout.

Establish what broke — mirror code (`graph/tree/mirror.ts`, `scan.ts`, `layout.ts`) or a test holding a stale contract (last commits touching graph/tree: 175aba9100, dc52ba14bc, 4f729f3763; the `core` library) — and fix by the failing-test rule. Done when the file passes whole.
