---
id: 01a13e02-f5f6-79d7-8db0-50366d19b176
title: Reopening a deleted mirror copies the registry under a new identity store
ord: 49
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13d2f-a3f4-7833-9183-21ba84bb0f8a",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13d2f-397e-77cc-90c3-6f0408aa72d5
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/serving/attach.ts
    symbol: registrySynced
  - kind: symbol
    ref: apps/tagma/server/src/graph/serving/attach.ts
    symbol: syncRegistry
  - kind: symbol
    ref: apps/tagma/server/src/graph/serving/open.ts
    symbol: makeMirrorBuilder
---
`serving/attach.ts#syncRegistry` and `registrySynced` treat a mirror as synchronized by path and machine registry version, while `open.ts#makeMirrorBuilder` holds that cache for the pool's lifetime. After `pool.release(treeRoot)`, deletion of the sqlite mirror, and `pool.resolve`, a new empty store at the same path skips copying project rows; `absorbMirror` fails on block insert. Found while porting servingDrill: command 16054764-67f8-409e-83df-0c335f76023c:166 gave 5 pass / 2 fail for plain/team mirror loss. Earlier tests created a fresh pool and never covered this. Account for the open store's identity/generation at the registry cache owner; verify on a real store: the pool survives, the mirror closes and is deleted, and reopening restores the block by UUID. Fixed in 8d9d87da70: the registry stamp accounts for path, generation value, and revision; a new identity object with the same generation does not change the result. The live-reopen tests and the earlier cold-pool recovery tests are kept: the two red live cases turned green; full joint triple run 30/0/237, later changed cases checked with narrow joint triple runs. A repeated public settled records written=0 on the existing syncRegistry span; latest check 12/0/99, types 2973 clean 9.26s, effect-style/check_law 0. A full module run, one independent review of the whole delivery, and statistical stability across machines are not yet proven.
