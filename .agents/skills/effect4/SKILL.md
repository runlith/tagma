---
name: effect4
description: Use before writing, editing, reviewing or debugging ANY code that imports from 'effect' or '@effect/*' — services, layers, streams, schemas, sockets, fibers, tests over Effect code, probes of Effect behaviour. This workspace runs Effect 4.0.1 (stable); what a model recalls is v3 or the 4.0 betas. Carries the one way services, functions, errors, failure handling, state and tests are written here, the rename table, the semantic traps measured in this workspace, and the one place the source is read from.
---

# Effect 4 in this workspace

Pinned: `effect@4.0.1` with `@effect/platform-bun`, `@effect/platform-node-shared` and
`@effect/sql-sqlite-bun` at the same version (root `package.json` → `workspaces.catalog`). Every name
below was verified against that version's source. When this file and the source disagree, the source
wins and this file is corrected.

Two dependency patches ride on it (`patches/README.md`): SQL statements parent their execution on
`sql.execute` by default, and a Bun worker closed before it listens is terminated instead of waited on.

## How Effect code is written here

One form per job. Where this section and `LLMS.md` upstream differ, this section wins: each choice
was measured on this codebase (decisions and numbers: graph spec 25d19486). The reference module is
`apps/tagma/server/src/remote/`: every form below stands there.

**A service is closures, never a class.**
```ts
export class Store extends Context.Service<Store, {
  get(key: string): Effect.Effect<Row, Missing>;
}>()('tagma/area/Store') {}

export const makeStore = Effect.fnUntraced(function* (input: { readonly limit: number }) {
  const files = yield* FileSystem.FileSystem;
  const rows = new Map<string, Row>();
  const load = Effect.fnUntraced(function* (key: string) { … });
  return Store.of({
    get: Effect.fn('Store.get')(function* (key) { … }),
  });
});

export const storeLayer = Layer.effect(Store, makeStore({ limit: 64 }));
```
- Dependencies are `yield* Tag` inside `make`; inputs that are not tags arrive as one record parameter.
  A `make` without inputs is an `Effect.gen` value: `Layer.effect(Ledger, makeLedger)`.
  State is `let`/`Map` in the closure; helpers are closures.
- An owner whose construction acquires no resource and needs no other owner's service may use a
  synchronous closure factory with one record input; anything else is an effectful `make` built in
  the layer. A factory that receives a resolved service in its record is not exempt, and a layer that
  `yield*`s tags only to pass them into a factory is the violation.
- Members are written inside `X.of({…})`: the tag types them, so no parameter types and no
  `Effect.fn.Return` are repeated (a `const` declared above is not typed by the tag). Dependencies are
  destructured once and used by name.
- A member that only forwards is the forwarded member: `byId: store.byId` (a class method keeps its
  arrow, `(id) => own.byId(id)`, or it loses `this`).
- One implementation filling several tags: `Layer.effectContext` returning
  `Context.make(A, a).pipe(Context.add(B, b))`. A service that exposes more than its tag names that
  shape: `type Reach = Access['Service'] & { … }`.
- A large service splits into sub-`make`s that `yield*` their own tags, never into constructor wiring.
- Classes are for data, errors and low-level primitives. In service code there is no `this`, no
  `const self = this`, no `Effect.gen({ self: this })`, no `implements Context.Service.Shape`.

- A body that is one expression is an arrow: `(id) => store.byId(id)`; `fnUntraced` goes over
  `function*` only; `return value`, never `return yield* Effect.succeed(value)`.
- Trap: TypeScript narrows a closure `let` after an assignment and does not widen it across `yield*`
  (false TS2367). Read such state through a function: `const ready = () => state._tag === 'ready'`.

**Functions.** A reusable effectful function is `Effect.fn('name')` or `Effect.fnUntraced` — never a
function that returns `Effect.gen`; a body that is one combinator call stays an arrow
(`(url) => Effect.tryPromise(…)`). Extra behaviour goes as trailing arguments of `Effect.fn`, not
`.pipe` after it; a trailing function receives `(effect, ...args)`, so behaviour that depends on a
parameter reads it there: `Effect.fnUntraced(function* ({ path }) { … }, (effect, { path }) => Effect.mapError(effect, failed(path)))`.
`Effect.gen` is for inline code only. A return type, where one is written, is `Effect.fn.Return<A, E, R>`;
it fixes the error channel, so a trailing `mapError` needs the return type left to inference.

**Spans are the performance telemetry.** In the server every span goes to `PerformanceTracer`
(`packages/performance`): a duration histogram and a failure counter per span name, slow and failed
traces kept for the `performance` skill. A span name is a stored key: metric history, the slow-span
judgement, the unit set (`OPERATION_IDS`, `agent.*`) and the `performance` skill all address it.
- No span over one SQL statement (`sql.execute` names it by `db.query.summary`) or over one call that
  has its own. A span name is unique across the server: `Ledger.byId` in three modules is one metric.
- Named (`Effect.fn('Tag.member')`, `Effect.withSpan`): every tag member with work of its own, and
  every internal step with a cost of its own — disk, git, a child process, SQL, the network, a wait
  on a lock/permit/queue, a computation over many rows, a group of SQL statements.
- `Effect.fnUntraced` (no span, ~0.16 µs a call against ~1.7 µs named): only a cheap helper whose time
  is inside its caller's span — a projection, a decode, a branch — or a step that only orders named
  steps (`arrange` in `remote/tailscale/serve.ts`).
- An Effect-valued member is named with `.pipe(Effect.withSpan('Devices.code'))`. A member that runs
  as long as its scope (`Access.serve`) and a Stream member take no span: the first never ends, so it
  measures nothing and holds every span beneath it in one trace never judged slow; the second measures
  its consumer's pace. Each finite pass under them is named (`Access.expose`, `PlacedSites.place`):
  it is the trace its steps land in.
- A step inside a service is named after the tag it serves (`Devices.exchange`); a module function
  after its area (`tailscale.serve`).
- Changing code keeps its spans: name, place and attributes. Renaming or removing one is its own
  decision, named in the commit, with every reader of the old name updated in the same change.

**Errors.**
- In-process errors: `Data.TaggedError`. Raise with `return yield* new Err(…)`. `Cause.pretty` prints only
  `Tag:` and a `message` field — an error read in logs carries `message`, never only `detail`/`reason`.
- What crosses a wire, a process pipe, a worker or a journal is a `Schema.Struct`/`Union` shape its
  boundary owner declares, with one projection from the error — not `Schema.TaggedError`:
  ```ts
  export class ListenerRefused extends Data.TaggedError('ListenerRefused')<{ readonly reason: string }> {}
  export const Blocked = Schema.Struct({ _tag: Schema.Literal('blocked'), problem: Schema.Literals(ACCESS_PROBLEMS), detail: Schema.String, … });
  yield* Stream.runForEach(exposure.expose(listener.port, settled), (step) => …).pipe(
    Effect.withSpan('Access.expose'),
    Effect.catchTag('ListenerRefused', (refused) =>
      Effect.sync(() => { state = { _tag: 'blocked', problem: 'listener-failed', detail: refused.reason, … }; })));
  ```
- A step whose every refusal already is a state its owner's wire carries fails with that value
  (`Effect<Standing, Blocked>` in `remote/tailscale/serve.ts`): one declaration, nothing to project.
- No `throw` and no `Schema.decodeUnknownSync` inside an effect: use `Effect.try({ try, catch })`
  and `decodeUnknownEffect`. `extends Error` only for sync throws outside Effect and for defects.

**Handling failure.**
- Continue after a typed refusal: `catchTag`/`catchTags`/`catchIf`. Translate: `mapError`/`tapError`.
  Both arms give a value: `Effect.match`/`matchEffect`.
- A reason nested in an error (`PlatformError` → `NotFound`): `Effect.catchReason('PlatformError',
  'NotFound', …)` / `catchReasons`; other reasons pass on untouched. Never `Effect.result` then
  `failure.reason._tag === '…' ? … : …`.
- `Effect.result` + `_tag` only where the result is kept as data; `if (r._tag === 'Failure') return
  <answer>` is `catchTag`/`catchTags` or `match`.
- Retrying is `Effect.retry` — `{ schedule, times, while, until }` with `Schedule.recurs`/`spaced`/
  `exponential` — never a `for (attempt…)` loop with `Effect.sleep`.
- A failure never becomes `false`/`undefined`/`true`/a default silently: a typed outcome, a typed
  refusal, or best-effort that logs its reason.
- `Effect.exit` + `Cause` only where the whole cause must be seen: defects or interruption re-raised,
  carried across a boundary, or logged whole.

**State, resources, time.**
- "Current value, then changes": `PubSub.sliding({ capacity: 1, replay: 1 })` + `Stream.fromPubSub`,
  not a hand-joined stream. `Stream.fromPubSub` subscribes at the first pull; when subscription must
  start at stream acquisition, use `PubSub.subscribe` in its scope + `Stream.fromSubscription`.
  `make` publishes the current value once: replay hands a subscriber only what was published. Publish
  with `PubSub.publish`: `publishUnsafe` skips the sliding strategy and, while any subscriber still
  holds the previous value, drops the new one for every subscriber.
  ```ts
  const moves = yield* Effect.acquireRelease(PubSub.sliding<void>({ capacity: 1, replay: 1 }), PubSub.shutdown);
  yield* PubSub.publish(moves, undefined);
  return { moved: Stream.fromPubSub(moves), … };
  ```
- A scope is opened and closed by its owner (`Effect.scope` in `make`, `acquireRelease`,
  `Effect.scoped`), never `Effect.runSync(Scope.make())`. Queues and PubSubs are built in `make`,
  not by `Effect.runSync` in a field.
- `Effect.run*` only at real edges (process entry, a foreign callback API), never inside a service.
- Time inside an effect is `Clock` (`Clock.currentTimeMillis`, `DateTime.now`), never `Date.now()` /
  `new Date()`: TestClock cannot move them, and three lease and stamp bugs came from exactly this.
- Waiting and deadlines are `Effect.sleep`, `Effect.timeout`/`timeoutOrElse`, `Effect.raceFirst`,
  never `setTimeout`, `Promise.race` or `Bun.sleep` beside an effect: those neither interrupt nor
  follow TestClock.
- Files go through the `FileSystem` service, not `node:fs/promises` in `tryPromise`: its
  `PlatformError` reasons feed `catchReason`, and a test can provide another one. An operation the
  service lacks (`access(…, X_OK)`) stays `node:fs` in `tryPromise` with a typed error.
- A semaphore, queue or map of locks belongs to its owner: `Semaphore.make` in `make`, not
  `Semaphore.makeUnsafe` at module level.
- Time is read from `Clock`/`DateTime`, never `Date.now()`/`new Date()`; a `Date` for a row wraps a
  value read there (`new Date(yield* Clock.currentTimeMillis)`).

**Tests** use `@runlith/effect-test` on `bun:test`:
```ts
import { expect } from 'bun:test';
import { it, layer } from '@runlith/effect-test';

it.effect('…', () => Effect.gen(function* () { … }));          // scoped, TestClock + TestConsole
it.live('…', () => Effect.gen(function* () { … }));            // real clock: git, disk, processes, real timeouts
layer(sharedLayer)('group', (it) => { it.effect('…', () => …) });  // built once, released after the group
```
- No `Effect.runPromise`, `ManagedRuntime` or hand-built `beforeAll` layers in a test body.
- A testing helper over an effectful `make` returns the Effect (or a Layer); the test `yield*`s it.
  `Effect.runSync` inside a helper to hand back a plain object hides the scope the service needs
  and fails the moment `make` waits.
- A layer fixture hands its services through context, never module-level `let`; a double built once
  is not re-provided as a Layer per call; a run helper left with only `provide` is deleted.
- A double is provided under its tag: `Layer.succeed(Tag, Tag.of({ … }))` or `Context.add(Tag, …)`;
  a member the test never reaches answers `Effect.die('…')`, not `as never` (`unreadLedger` in
  `remote/testing/doubles.ts`). A service built once and used after is given a `Context` of
  doubles: `Effect.provide(make, layer)` closes the layer as soon as `make` returns. The test waits
  on an event (`Queue.take`, `Deferred.await`) and moves time by `TestClock.adjust`
  (`remote/reach.test.ts`):
  ```ts
  const door = (given: Door) => Context.make(Settings, Settings.of({ changes: …, read: unused, … })).pipe(
    Context.add(Ledger, given.ledger ?? Ledger.of({ ...unreadLedger, origin: Effect.succeed(ORIGIN) })),
    Context.add(Exposure, Exposure.of({ expose: …, place: () => Stream.never, withdraw: given.withdraw ?? … })), …);
  it.effect('switching access off withdraws the mapping of the settled origin again after each refusal', () =>
    Effect.gen(function* () {
      const reach = yield* Effect.provide(makeReach, door({ switches, withdraw }));
      yield* Effect.forkScoped(reach.serve(listener));
      yield* Queue.offer(switches, false);
      expect(yield* Queue.take(withdrawals)).toBe(PORT);
      yield* TestClock.adjust('2 seconds');
      expect(yield* Queue.take(withdrawals)).toBe(PORT);
    }));
  ```
- A test that waits on real time (`Effect.timeout`, `sleep`, processes) runs under `it.live`;
  under `it.effect` the clock moves only by `TestClock.adjust`. A `layer` group has no `it.live`:
  `layer(l, { excludeTestServices: true })` keeps the real clock. A process-wide fixture (`PATH`,
  `fetch`) is a `Layer.effectDiscard(Effect.acquireRelease(…))` merged into that layer
  (`remote/tailscale/exposure.itest.ts`).

## Where the source is read

- **`.external/effect`** (main checkout root) — the upstream clone; existence AND behaviour are read
  at the tag `effect@4.0.1`, whatever its HEAD: `git -C .external/effect show effect@4.0.1:packages/effect/src/Effect.ts | rg -n "^export (const|function) name\b"`;
  `git -C .external/effect grep -n <pattern> effect@4.0.1 -- packages/effect/src`.
  Area modules live under `src/<area>/**` (`src/process/ChildProcessSpawner.ts`, `src/http-api/`,
  `src/socket/Socket.ts`); platform packages under `packages/platform/{bun,node-shared}/src`.
- **NEVER `node_modules`.** The bun store holds several `effect` versions side by side (v3 among
  them); `effect@*` globs, `ls node_modules/effect`, and any probe or scratch file OUTSIDE the
  workspace can resolve another version and answer `X is not a function` for perfectly good code.
- **Reserved words are aliased**: `catch` and `try` are declared as `catch_`/`try_` and exported as
  `catch_ as catch`. A grep for `export const catch` finds nothing; grep `catch_`.
- **Probes run inside the workspace** (a scratch file under a package that depends on `effect`, or
  `bun -e` with that package as the working directory), never in `/tmp`, never from the repo root.
- **`bun test` does not typecheck.** A missing name is `undefined` at runtime and fails INSIDE
  `Pipeable.js` as `args[N] is not a function … is an instance of Object` — the message never names
  the combinator. Run `typecheck` first; `runlith-typecheck` also runs the rename scan below.

## Names that do not exist in 4.0.1

The scan in `packages/tsconfig/src/effectNames.ts` fails `typecheck` on each of these and prints the
current spelling. Do not write them, do not "fix" the scan.

| Recalled spelling | 4.0.1 |
|---|---|
| `Effect.fork` | `Effect.forkChild` (owned by the parent) / `forkScoped` / `forkIn(scope)` / `forkDetach` |
| `Effect.catchAll` | `Effect.catch` |
| `Effect.either`, `Either.*` | `Effect.result` → `Result`: `Result.isSuccess`, `.success` / `.failure` after `_tag` narrowing |
| `Effect.merge` | `Effect.result` and read both arms |
| `Effect.zipRight` | `Effect.andThen` (same positional shape) |
| `Effect.tapErrorCause` | `Effect.tapCause` (also `tapError`, `tapDefect`) |
| `Effect.timeoutFail({duration, onTimeout})` | `Effect.timeoutOrElse({ duration, orElse })`; `timeoutOption` |
| `Effect.yieldNow()` | `Effect.yieldNow` is a VALUE: `yield* Effect.yieldNow` |
| `Effect.gen(this, f)` | `Effect.gen({ self: this }, f)` — binds `this` inside `f`, NOT a `self` variable (bare `self` is bun's global) |
| `Effect.Effect.Success<T>` | `Effect.Success<T>` |
| `Effect.makeSemaphore`, `Mutex` | `Semaphore.make(permits)` from `'effect'` |
| `fiber.await` (a member) | `Fiber.await(f)` answers the `Exit`; `Fiber.join(f)` the value; `Fiber.awaitAll` / `joinAll` (`await` is exported as `await_ as await`) |
| `fiber.unsafeInterrupt()` | `Fiber.interrupt(f)` (effect) / `f.interruptUnsafe()` |
| `Fiber.poll` | none; `Fiber.join(f).pipe(Effect.timeoutOption(Duration.zero))` answers `Option<A>`, not `Option<Exit>` |
| `Stream.runIntoSink(s, sink)` | `Stream.run(s, sink)` |
| `Stream.mapConcat` | none — restate with `Stream.flatMap` + `Stream.fromIterable` |
| `Stream.unwrapScoped` | `Stream.unwrap` (already excludes `Scope` from R) |
| `Stream.mapAccum(s, f)`, `Stream.scan(s, init, f)` | the initial state is a THUNK: `mapAccum(() => s, f)`, `scan(stream, () => init, f)` |
| `Stream.filterMap(a => T \| undefined)` | takes a `Filter`; or `Stream.filter` + `Stream.map` |
| `Schema.Literal(a, b)` | `Schema.Literals([a, b])`; `Literal` takes ONE value |
| `Schema.Union(A, B)` | `Schema.Union([A, B])` — varargs fail at runtime as `members.map is not a function` |
| `Schema.TaggedErrorClass` | `Schema.TaggedClass` / `Schema.TaggedError` |
| `Schema.optionalWith` | `Schema.withDecodingDefaultKey` / `withDecodingDefaultTypeKey` |
| `Schema.isLengthBetween`, `isStartsWith`, `isEndsWith`, `isIncludes`, `isSizeBetween` | `isBetweenLength`, `isStartingWith`, `isEndingWith`, `isIncluding`, `isBetweenSize`, `isBetweenProperties` |
| `.annotate({ parseOptions })` | ignored by the parser — pass options to the decode call (see below) |
| `Schema.decodeUnknownExit` + `.success` | `decodeUnknownResult`; an `Exit` answers `.value` / `.cause` |
| `Context.Tag` | `Context.Key`; services are `Context.Service`; `Context.Reference` is itself an effect (no `.asEffect()`) |
| `Predicate.isRecord` | `Predicate.isObject`: non-null, non-array object, including class instances |
| `Scope.CloseableScope`, `Scope.asEffect()` | `Scope.Closeable`; no `asEffect` |
| `Duration.DurationInput`, `Duration.decode` | `Duration.Input`; `Duration.millis` / `toMillis` |
| `FileSystem.Size`, `FileSystem.SizeInput` | `ByteSize.bytes(n)`; `File.Info.size` is a `ByteSize` |
| `FileSystem.OpenFileOptions` | `Parameters<FileSystem.FileSystem['open']>[1]` |
| `BunFileSystem.FileSystem` | `FileSystem` from `'effect'`, layer from `BunFileSystem.layer` |
| `from 'effect/unstable/<area>'` | `from 'effect/<area>'`: `effect/http`, `effect/http-api` (was `httpapi`), `effect/rpc`, `effect/process`, `effect/sql`, `effect/socket`, `effect/cli`, `effect/workers` |
| `from 'effect/Encoding'`, `Encoding.randomHex` | `effect/encoding/Hex` (`Hex.random`), `effect/encoding/Base64`, `effect/encoding/Base64Url` (`Base64Url.encode`) |
| `ChildProcess.ChildProcess`, `ChildProcess.ChildProcess.Spawner` | `ChildProcessSpawner.ChildProcessSpawner` from `'effect/process'`; `ExitCode` is a brand, not `number` |
| `Flag.string`, `Flag.integer`, `Flag.choice`, `Argument.string` | PascalCase: `Flag.String`, `Flag.Int`, `Flag.Finite`, `Flag.Literals`, `Argument.String`; combinators (`optional`, `withDefault`, `withDescription`) keep their case |
| `Config.string`, `Config.redacted`, `Config.mapOrFail` | `Config.String`, `Config.Redacted`, `Config.Int`, `Config.mapEffect` |
| CLI `Command.Any` | `Command.Command.Any` |
| `RpcSerialization.layerMsgPack` | gone: `layerJson`, `layerNdjson`, `layerSchemaBinary` |
| `socket.run(handler)`, `runRaw`, `Socket.make({ runRaw })` | `Socket.readerBytes(socket)` in a scope, then `yield* pull` in a loop; `socket.writer` yields `{ write, writeAll }`; `Socket.make({ reader, writer })` |
| `ManagedRuntime.runtime()` / `runtimeEffect` | `context()` / `contextEffect`; `dispose()` is a Promise, `disposeEffect` the effect |
| `catchTag('TimeoutException')` | the tag is `'TimeoutError'` |
| `import { Effect } from 'effect/Effect'` | `import { Effect } from 'effect'` (root barrel) and `Effect.Effect<A, E, R>`; `import * as Effect from 'effect/Effect'` is also legal |

## What 4.0.1 changed that compiles anyway

- **Parse options are per call, never per schema.** A `parseOptions` annotation is read by nobody;
  `decodeUnknownEffect(schema)(input, { onExcessProperty: 'error' })` applies to the WHOLE tree, and
  the default is `'ignore'`. There is no node-local strictness: a strict root over a lenient facet is a
  separate key check (`decodeThreadEventPayloadResult` in `packages/agent/src/thread/persisted.ts`).
  Operation input decodes with `inputParsing`, graph documents with `closedParsing` (the documents
  `CLOSED_FIELDS` names in `graph/vocabulary/declarationRules.ts`), and a tool declares its own
  `parseOptions`, which `toolDecode` passes on.
- **JSON Schema export changed under every tool schema.** Objects are open by default — the
  generators pass `{ onExcessProperty: 'error' }` to keep `additionalProperties: false`. A
  `Schema.isPattern` regex is exported only with the `u` flag: write `/…/u` (or
  `new RegExp(source, 'u')`). Checks on `Schema.Number` are dropped (its JSON form has string
  sentinel arms): a bounded number a tool exposes is `Schema.Finite.check(…)`. An empty
  `Schema.Struct({})` renders `{ not: { type: 'null' } }`.
- **`make` on a schema is a getter.** `Object.assign(schema, { make })` throws at module load
  (`Attempted to assign to readonly property`); name the helper otherwise (`ToolCallPart.from`).
- **Sockets pull.** Every close fails the pull with `SocketError` wrapping `SocketCloseError` — a clean
  end too (code 1000). The writer waits until a reader is acquired, so an accepted server socket
  writes nothing until something acquired `socket.reader`. A test double is `Socket.make({ reader,
  writer })` with `upgrade: Socket.SocketUpgradeError.unsupported`.
- **File handles are bigint-addressed.** `seek(offset: bigint)` answers `Effect<bigint, PlatformError>`
  (it can fail now); `read`/`write` answer `number`; `truncate` and `readAlloc` take `number`.
- **`Scope.close` takes a `Scope.Closeable`**, and finalizers run uninterruptibly: a finalizer that
  waits holds the close for its whole wait. A layer that must tear itself down forks its own
  `Scope.fork(yield* Effect.scope)` and closes that.
- **`Effect.timeoutOrElse` runs `orElse` after the source is fully interrupted**, not beside it. A
  fallback that unblocks the source (kill, end, close) only works if the source's wait is interruptible.
- **`SqliteClient.layer` fails with a typed `SqlError`** when the database cannot be set up.
- **The live socket speaks JSON** (`liveSerialization` in `platform/contract/wire/live.ts`); bytes
  cross it as `Schema.Uint8Array` (base64). `layerSchemaBinary` refuses unions it cannot tell apart.
- **drizzle-orm's declarations still import `effect/unstable/sql/SqlError`**: under `skipLibCheck`
  that type is `any` inside drizzle's error channels.
- **Bun drops a worker message posted before the worker listens**; a worker entry that loops must
  also end when its runner closes (`packages/performance/src/store/worker.ts`).

## Semantics that trap regardless of version

- **Channels are invariant-ish**: `Effect<A, E, R>` declares all three `out`; `Effect<A, E, any>` and
  `Effect<A, E, unknown>` do NOT assign to `Effect<A, E, never>` (v3's contravariant R did). An
  unannotated helper, a generic `R` not collapsed by `Effect.provide`, a forgotten `R` on a
  `Effect.fn` return, a `Scope` leaked from `forkScoped` — each surfaces as `unknown is not assignable
  to never`. Annotate the owner; never `as never`, never `as Effect<…>`.
- **`Effect.result` catches typed failures ONLY**: a defect (`throw` inside `Effect.sync`) and an
  interruption pass through it. A refusal road that must see defects reads `Effect.exit` and the
  `Cause`.
- **`Effect.uninterruptible` is not atomicity**: another fiber's write lands between your read and
  your apply. Serialize with a semaphore or one owner.
- **An ending that its own signal interrupts never writes**: a finalizer forked under the attempt it
  ends is cut by the interrupt it triggers. Endings are `uninterruptible`; admission is one act.
- **`Effect.timeoutOrElse` inside `uninterruptible` still cuts** the inner effect; an uninterruptible
  SOURCE holds the fallback until it finishes.
- **`Stream.timeoutOrElse` / `Effect.sleep` run on `Date.now()` + `setTimeout`**: a machine sleep
  expires every deadline at wake. A watchdog that must not count sleep measures its deadline on
  `clock.monotonicTimeNanosUnsafe()` (Bun on macOS: stops while the machine sleeps) and re-sleeps
  the remainder, as `packages/llm/src/llm/route/liveness.ts` does.
- **A forked fiber inherits spans and `References.CurrentStackFrame`**: a self-scheduling background
  pass clears both at its fork boundary with `Effect.updateContext(fork, (ctx: Context.Context<never>) =>
  Context.omit(Tracer.ParentSpan, References.CurrentStackFrame)(ctx))`; otherwise each retry retains the
  earlier passes' span and diagnostic frame chains. `root: true` resets span ancestry alone. A
  publication needing only a new trace omits `Tracer.ParentSpan` alone.
- **`Effect.callback` runs its registrar at subscription**: an `AbortSignal` already fired never fires
  again — read `signal.aborted` synchronously first, or the effect hangs to its timeout.
- **`Effect.acquireRelease` mask**: acquire is not restorable; the finalizer is attached in the same
  step, so there is no window between creation and ownership.
- **`NodeFileSystem.makeDirectory` (effectify) has no cancellation**: interrupt abandons the wait,
  not the syscall.
- **TestClock**: `Fiber.join` on a sleeping fiber hangs until `TestClock.adjust`; one `adjust` drains
  every timer up to the target, including ones scheduled during the walk; "deadline reached but not
  fired" is not provable through `adjust`.
- **`pipe` takes at most 20 functions**; the 21st fails as `unknown is not assignable`, not as an
  arity error. Split the chain or `Layer.merge` first.
- **`Effect.forEach(rows, decode)`** passes `(element, index)`; a decoder's second parameter is
  `options` — wrap in a lambda.
- **A data-first helper used eagerly as a pipe step** becomes an Effect object, not a function:
  `args[0] is not a function … instance of Object`.
- **Hand-typed generator functions** containing `yield*` fail assignability; write `Effect.fn` and let
  it infer E and R; annotate with `Effect.fn.Return<A, E, R>`, never a hand-written `Effect<…>`.
- **`Exit` with the wrong `A` does not pass through** a failure: rebuild with `Exit.failCause(exit.cause)`.
- **A sync → Effect signature migration** (`x(): boolean` → `Effect<boolean, E>`) breaks every
  caller at runtime as `is not a function` in a shared checkout: move the declaration, its
  implementation, its stubs and its `yield*` sites in one change.
- **Cast is not decode**: `response.json() as Promise<typeof schema.Type>` hides a missing field
  behind `undefined`; decode with the schema.
- **`Effect.try`** defaults its error to `Cause.UnknownError`; pass `{ try, catch }` to type it. Declared
  as `try_ as try`, like `catch`.
- **`yield*` takes a Yieldable only**: a plain value, a failure union or a `never` fails as
  TS2488 `must have a '[Symbol.iterator]()'`; an Effect used WITHOUT `yield*` reads as an object
  with no members (`Property 'x' does not exist on type 'Effect<…>'`).
- **`Schema.Struct<F>['Type']`** reads the type off a BUILT schema; `Schema.Struct.Type` on the
  constructor does not exist.
- **A total error mapper** `(self: Effect<A, PlatformError, R>) => …` refuses an effect whose E is
  already a union (`CredentialsFailed | PlatformError`): map at the site that produced the single
  error, or `Effect.catchTag` the member.
- **`ManagedRuntime` type annotations from v3** (`ManagedRuntime<UnionOfServices, E>`) do not fit
  the v4 parameters; let `ManagedRuntime.make(layer)` infer, or name `ReturnType<typeof make…>`.
- **`ChildProcessSpawner` offers no managed timeout or stop cause**: a call ends with an exit code
  or a `PlatformError`; the deadline and its provenance are the host's to add.
- **`Effect.forEach` is sequential by default** (`concurrency ?? 1` in `internal/effect.ts`); pass
  `{ concurrency }` for fan-out.
- **`Option`, `Result`, `Ref`, `Deferred`, `Fiber` are not Effects in v4**: convert before `yield*` —
  `Effect.fromOption`, `Effect.fromResult`, `Ref.get`, `Deferred.await`, `Fiber.join`
  (`migration/yieldable.md`).
- **Upstream `LLMS.md` rules kept here**: untrusted data is decoded with `Schema`, never checked
  field by field; type guards come from `Predicate` (`Predicate.isObject`, `isString`), never a local
  `isRecord`; a `Context.Reference` is declared once at module level, never per call; child fibers
  are held in `FiberSet`/`FiberMap` (`Fiber.children` and `Effect.forkAll` are gone); an `it.effect`
  body is already scoped — no `Effect.scoped` around it. Its `Schema.TaggedError` for errors and
  `fnUntraced` "for library code" are overridden by the errors and spans rules above.

## Depth

The readings these lines summarize stand under the rule "Effect is read at the version that runs"
in the graph (`search_blocks` kind `research`, term `effect`). A new reading is deposited there, one
finding per block; a rename found missing here is added to the table AND to the scan in the same
change.
