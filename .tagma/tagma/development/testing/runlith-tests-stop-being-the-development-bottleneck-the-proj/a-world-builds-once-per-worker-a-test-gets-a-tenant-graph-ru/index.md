---
id: 01a16ac4-44bf-7e0a-8178-b701ff15f336
title: "A world builds once per worker, a test gets a tenant: graph, runtime and terminal worlds not assembled per file"
ord: 2
tags: ["spec"]
fields:
  {
    "status": "open"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/composition/testing
---
**Today.** `layer(…)` from `@runlith/effect-test` builds a world per group, i.e. per file. `--parallel=2` in Bun 1.4 enables `--isolate`, and each file starts with an empty module registry: the graph templates that `graphFixture` keeps in module memory (`idleHomes`, `templates`) do not survive to the next file, and the full-runtime world (`makeDoorWorld`) has no template at all. The graph world costs ~1.6 s CPU of its process per file before the first test, the runtime world ~6 s before the first project (parent spec probes).

**World per worker.** Test scripts launch with `--parallel=N --no-isolate`: a Bun worker keeps one module registry for all its files (`bun-types/docs/test/parallel.mdx`). Worlds live in the kit's "worlds" entry ([[3e26831e]]) — an Effect registry: `Scope`, finalizers, the `FixtureScope` report. It replaces `idleHomes` and `templates` in `graphFixture.ts`; no second template mechanism remains ([[dd380bf6]]). A world is defined by kind and serializable parameters; the worker's first file builds it and takes a template, the following tests take tenants ([[14455f40]]).

A world also exists in the unit layer, without resources: the operation catalog (`operationCatalogLayer`). Its cold build is ~1.6 s CPU (import ~0.8 s, async build ~1.9 s wall), and checks over it run 1–70 ms. The unit-layer hook timeout is 1000 ms, and under machine load the build does not fit in `beforeAll`: on 2026-10-24 `handles.test.ts` fell in a hook at 1003 ms. Until the world per worker, the catalog groups in `handles.test.ts`, `places.test.ts` and `operationCatalog.test.ts` carry temporary 10 s setup timeouts via `layer(source, { timeout })`; test-body and preload timeouts unchanged. The world per worker removes that failure along with the cost.

**World end.** Bun has no "worker end" hook: preload hooks run for each file. So the world is not freed asynchronously at worker end: its processes are registered in the kit's guard and removed synchronously on process exit, and whatever outlives the exit is found by the next run's `sweep`. World directories live under the run root and leave with it. The world-freeing report is replaced by the next run's line about what `sweep` found.

**World key.** Today `kindOf` keys `prepareEffect` by function identity (`graphFixture.ts:141-155`), and `makeDoorWorld` takes `models` and `decisions` functions: two files with identical setup get different worlds. The world key is the declared kind name and serializable parameters; setup not reducible to them is part of the tenant, not the world.

**Shared by default, separate by declaration.** A test that mutates whole-machine or process state — machine-scoped settings, the provider registry, accounts, runtime clocks, `process.env` (touched by 36 server test files) — declares it when taking the world and gets its own instance. Without a declaration the world is shared.

**Failures under a shared world.** Under `--no-isolate`, 6 graph-part tests failed on 5 s (indexed title navigation, tree ledger, served tree marks, served tree refresh); the timeout source and cause undetermined. First step: determine them from the run report and worker sequence. State leaking between files is fixed at the state owner, not by returning isolation; flakies [[f033c530]] (fs.watch without a file name) checked the same way.

**Bindings.** `layer(world('graph', …))` in `effect-test` and a plain `await world('graph', …)` for non-Effect tests.

**Acceptance.**
- The run report shows: each world kind built no more than once per worker; the share of files that took a ready world recorded.
- The server integration layer's graph part (110 files) and the whole server integration layer measured before and after with one command; the contribution recorded under the parent spec.
- All server tests green on three shuffled file lists and in an isolated run.
- The report names the tests that took their own world by declaration, and their share in the measurement.
