---
id: 01a0c83d-a90d-739e-b053-727e5d33e95f
title: Build the zone for the dialog the kit builds itself
ord: 82
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c841-f927-7919-b86c-01a321bee7ca",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c83d-a829-7d4b-bfbb-6824de36c9fd
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: packages/primitives/src/dialog
---
Fill [[c378594a]] with the claims its code establishes. Read every file under `src/dialog/` whole except `dialog-scroll-lock.ts`, which belongs to [[342afbc8]] and is claimed there, with `src/dialog/dialog-escape.test.ts` and `src/dialog/dialog-focus.test.ts`. Watch: why presence is withheld a microtask past mount and which parts render from `present` rather than from `open`; why the document-level escape handler defers to a macrotask to read `defaultPrevented`, and how the topmost open content is decided; the four dismissal behaviours and where each of them is resolved; why a focusout is answered only when focus landed nowhere, and why `relatedTarget` rather than `activeElement` is the honest signal there; what the named autofocus attribute and the autofocus mark each buy a product; and why the portal mounts into one overlay root it creates if absent. `src/dialog/dialog-id.ts` is dead and has a removal task of its own — write no claim about it. Every claim hangs under that area, bound to the narrowest sources that can contradict it and verified after a reading of all of them. Done when the area's body is corrected wherever the code contradicts it, `run_doctor` over its paths leaves nothing open, and a review passes. The module is [[de36c9fd]]; the reference shape is the Layer kit [[59cc3c49]].