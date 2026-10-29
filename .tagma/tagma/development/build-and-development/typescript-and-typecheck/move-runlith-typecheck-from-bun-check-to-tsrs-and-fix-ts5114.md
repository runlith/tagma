---
id: 01a16ab9-66bc-7ae7-9bfc-7459f4cc17fc
title: Move runlith-typecheck from bun check to tsrs and fix TS5114 in manifest checks
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16a96-1350-7ed8-8d56-3eb5f05787cb",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/contract/service/manifest.ts
  - kind: file
    ref: packages/tsconfig/src/typecheck.ts
---
The operator's decision: TypeScript packages are checked by tsrs (the Rust port of TS 7 from Oxc) with 4 checkers instead of `bun check`. On `apps/tagma/server` it is four times faster at the same memory (one sample, 2026-10-23). Engines on TS 7.1 find TS5114 on the server: the `Gather` type in `platform/contract/service/manifest.ts` glues manifest records with non-tail recursion, and at 47 developer-build modules it hits the depth limit. `bun check` never saw it. The fix is tail recursion with an accumulator; rule [[d028ec40]] and the module card are updated by the same work. The switch surfaced two more errors that tsgo 7.1 confirms but `bun check` missed: narrowing `typeof state` to `never` in `DemoServer.test.ts` and in `ThreadEffectSettlement.ts` the `transitionNow` parameter `E`, which infers differently depending on check order (tsgo sees the error at 4+ checkers and misses it at 1–2; tsrs sees it in no mode). `E` is now explicit.
