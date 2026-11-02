---
id: 01a187c1-de8f-748b-a82d-531f974b383b
title: submit_work refuses lines-held on an array .map() call matched to a peer's class field named map
ord: 153
tags: ["reflection"]
fields:
  {
    "actual": "refused[lines-held]: \"map in packages/vigla/src/runtime/reactivity/batch.ts:69, held by scheduler\" — the only `map` in async.ts is `thunks.map(...)` on a readonly array parameter; the landing waits for the peer or carries its unrelated 195-line batch.ts whole",
    "command": "submit_work paths=[…, packages/vigla/src/runtime/dom/async.ts, …] in ~/runlith/dromon",
    "expected": "async.ts imports only `resumed` and `suspend` from batch.ts, so a peer's uncommitted `Batch.map` field is no dependency and the landing proceeds"
  }
---
Filed from project `vigla`.

batch.ts:69 is `map: Map<Source, unknown> | null = null;`, a field of `class Batch`, which async.ts never imports or receives (its batch.ts import is `import { resumed, suspend } from '../reactivity/batch.ts'`). The receiver of `.map` is typed `readonly (() => unknown)[]` in the same function signature, so its type is provable locally. A plain `git commit` is no way out here either: other files of the same landing carry a second peer's uncommitted lines, which only submit_work slices apart.