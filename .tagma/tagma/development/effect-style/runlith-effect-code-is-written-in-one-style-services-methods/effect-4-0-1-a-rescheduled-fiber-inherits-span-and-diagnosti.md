---
id: 01a13c0c-5ad1-72bc-818c-d55da3c3dfde
title: "Effect 4.0.1: a rescheduled fiber inherits span and diagnostic-frame chains"
ord: 11
tags: ["research"]
fields:
  {
    "source": {
      "name": "effect",
      "ref": "4.0.1 (.external/effect, tag effect@4.0.1)"
    }
  }
edges:
  - kind: relates
    to: 01a13bfd-972f-73fc-8420-939e4da86039
---
Read `.external/effect` at tag `effect@4.0.1`: `packages/effect/src/internal/effect.ts` (`makeFn`, `forkUnsafe`, `forkIn`), `FiberMap.ts` (`runImpl`) and `References.ts` (`CurrentStackFrame`). `forkUnsafe` hands the child fiber the parent's current Context; `Effect.fn` adds into it a span and diagnostic frames referencing the previous frame. So a background attempt scheduling the next from its own named step retains the chains of all previous attempts. `root: true` changes the span parent but not the diagnostic frames.

The reproduction is kept in `apps/tagma/server/src/plugins/plugins.itest.ts`, test `a background launch retry starts its own diagnostic context instead of retaining earlier attempts`: the public environment provider refuses `PluginLaunchRefused` three times; on the third call before the fix, ancestry held two `Plugins.refresh` and two same-named frames, after `Effect.updateContext(fork, (ctx: Context.Context<never>) => Context.omit(Tracer.ParentSpan, References.CurrentStackFrame)(ctx))` — one per call. A watcher's first retry may be a separate entry, so two calls were not enough to reproduce. The measurement proves the bounded depth of these chains in the scenario, not the number of retained bytes or the running server's long-term behaviour.
