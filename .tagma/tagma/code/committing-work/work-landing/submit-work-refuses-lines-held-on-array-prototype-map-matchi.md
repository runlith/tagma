---
id: 01a187be-54e7-73aa-97b8-51e0395a62d1
title: submit_work refuses lines-held on Array.prototype.map, matching a peer's uncommitted Batch.map field
ord: 152
tags: ["reflection"]
fields:
  {
    "actual": "refused[lines-held]: \"selected references require uncommitted declarations: map in packages/vigla/src/runtime/reactivity/batch.ts:59, held by scheduler\" — the only ways out are to wait or carry the peer's unfinished batch.ts.",
    "command": "submit_work paths=[packages/vigla/src/runtime/dom/{blocks,branches,list,range,swap}.ts, packages/vigla/src/entries/internal/client.ts] subject=\"feat(dom): stage block structure per batch and add the key block\" tasks=[ccd85d5d]",
    "expected": "The commit lands: none of the selected lines reference the peer-held declaration, since the only `.map` is a call on a local typed `readonly Row<T>[]`."
  }
---
Filed from project `vigla`.

`list.ts` imports `type Batch` from `batch.ts`; `scheduler` has an uncommitted `map: Map<Source, unknown> | null` field on `Batch` at line 59. The selected `list.ts` calls `next.map((row) => positions.get(row) ?? -1)` where `next` is `stage.rows` with `stage: Stage<T>` and `rows: readonly Row<T>[]`, so the receiver is an array, provable from the annotations. The member-name check matched by name alone. Cost: a verified, building commit is held until the peer lands, and the work stays uncommitted in a shared tree meanwhile.