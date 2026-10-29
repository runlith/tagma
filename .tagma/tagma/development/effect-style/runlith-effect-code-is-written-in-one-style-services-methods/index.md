---
id: 01a13b37-5351-7e3a-bda9-f7bf25d19486
title: "Runlith Effect code is written in one style: services, methods, errors, state and tests — one recorded shape each"
ord: 9
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
## Need

Effect 4 code in the runlith server and packages is written one way for each recurring task: declare and implement a service, write an effectful method, declare an error, hold state, test. New divergence does not appear because the style is recorded and checked at commit; old divergence leaves module by module.

## Why

The 2026-10-14 research (nine independent code readings plus upstream Effect 4.0.1; reports lived in the researcher thread's scratch) found:

- service implementations come in at least six shapes; a class method returning an effect in five (`const self = this` + `Effect.gen` ~1100 places, `Effect.gen({ self: this })` ~340, `Effect.fn` with `this:` ~140, a field with `Effect.fn` and a doubled signature ~137, `Effect.suspend`);
- canon Effect writes services as closures in `make` + `X.of`; only the key is declared as a class there. There is no canonical shape for a class service — hence most of the noise, wide constructors (up to 26 parameters) and 461 `as never` in tests;
- errors: on the server `Data.TaggedError` 135 vs `Schema.TaggedError` 50, in packages it varies by package; `throw` and `decodeUnknownSync` inside effects;
- `Effect.result` + `_tag` branching in ~1000 places; hand-made subscriptions, caches and pools next to unused `PubSub`, `SubscriptionRef`, `Cache`, `Pool`;
- tests: no `it.effect` equivalent — 3145 `Effect.runPromise`, 117 hand-made `world` helpers, hand-built layers in `beforeAll`/`afterAll`.

The `effect4` skill teaches only the names and traps of version 4.0.1, not the style; agents copy the neighbouring file and their Effect 3 memory.

## Decisions

- The test runner stays `bun test`: with equal file isolation it is 2.5x faster than Vitest on unit tests and no slower on integration and system (measured 2026-10-14, one run on the operator's machine). A home-grown `it.effect` over `bun:test` and `effect/testing` replaces `@effect/vitest`.
- The official `@effect/tsgo` linter runs by hand (`bun run effect:lint`); it is not wired into typechecking: most divergence is syntactic, and tsgo does not catch it.

## Research decisions of 2026-10-14

- **Services are closures, as in Effect canon.** `make = Effect.fnUntraced(function* (input) { const dep = yield* Tag; let state; const helper = Effect.fnUntraced(…); return X.of({ … }) })`; `Layer.effect(X, make)`, and `Layer.effectContext` when one implementation fills several tags. Tag members are `Effect.fn('Tag.member')`, inner functions `Effect.fnUntraced`, state `let`/`Map` in the closure, non-tag inputs a single parameter record for `make`. A service exposing more than its tag names its type: `type Reach = Access['Service'] & { … }`. Classes are for data, errors and low-level primitives, not services.
  Why (experiment [[cb27ea54|classes and closures]], three services in two variants, both passing typecheck and module tests): closures are smaller in all three (−13%, −20%, −5%) against classes with `Effect.fn({ self: this })` (−7%, −9%, −3%); all five current `this` shapes disappear; member parameter types come from the tag; an inner function costs 0.16 µs vs 0.67 µs (in 4.0.1 `fnUntraced` has no `{ self }`, so the class is left with only tracing `Effect.fn`); a large service splits into sub-`make`s that take their own tags, with no threading through the constructor; a test substitutes doubles by tag name, not by position out of 17. Price: doubles go through `Context.add` by tag (more imports; partial doubles still need `as never`), and extra service surface is an explicit type.
  Trap: `let` in a closure narrows TypeScript after assignment and does not widen across `yield*` — read such state through a function (`const ready = () => state._tag === 'ready'`).
  Not measured: the cost of named spans on hot members under `PerformanceTracer`, and the memory of services built many times (per thread, per request).

- **Errors.** An error inside a process is declared with `Data.TaggedError`: none of our 222 `Schema.TaggedError` classes takes part in a codec, and its constructor only costs more and throws on invalid fields. What crosses a wire, a process pipe, a worker or the journal is a `Schema.Struct`/`Union` shape with `_tag` declared by the boundary owner, with one projection from the error. `extends Error` is only for synchronous `throw` outside Effect and for defects. This diverges from Effect's `LLMS.md` but matches how the authors themselves write (they use `Data.TaggedError` more often).
- **`Effect.result`.** Branching on `_tag` only when the result is stored as data (~7% of the sample). Everything else is `catchTag`/`catchTags`/`catchIf` for continuing after a failure, `mapError`/`tapError` for translation, `Effect.match`/`matchEffect` where both branches produce a value. A failure never silently becomes `false`/`undefined`/`true`: a typed outcome, a failure, or best-effort with a reason.
- **Primitives.** "Current value, then changes" is `PubSub` with `replay: 1` and `Stream.fromPubSub`, not hand-rolled stitching. Synchronous subscriptions over a `Set` with subscriber-failure isolation stay: `PubSub` cannot do that. Unsubscription in a layer is a Scope finalizer. Keyed waiting is `held/Waiters`, not home-grown. The owner creates and closes the Scope, never `Effect.runSync(Scope.make())`.

## Sequence

1. Decisions: classes or closures (experiment), `Data` or `Schema` for errors, where `Effect.result` is justified, which hand-made mechanisms to replace with Effect primitives.
2. Home-grown `it.effect` and a pilot on one module.
3. The style is recorded in the `effect4` skill; commit-time syntax checks reject new violations, old ones stand as debt.
4. Module-by-module migration: production code with its tests together, tests on `it.effect`.

## Done when

- every task under "Need" has one recorded shape, and commit-time checks hold it;
- these checks' debt is empty;
- server and package tests go through `it.effect`; no hand-written `Effect.runPromise` remains in test bodies.
