---
id: 01a127f0-4ce7-7edb-adb0-9eb640ffd688
title: "Optional values without manual assembly: type and schema agree on undefined, conditional spread leaves the code"
ord: 19
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/utils/src/object.ts
---
## Why

The live code holds 1620 conditional spreads of the form `...(x === undefined ? {} : { x })`. The problem is not the syntax: "no value" has no owner, and everyone assembling an object decides it by hand. Verified by execution:

- **`Schema.optionalKey`** (655 calls, 98 files): with `exactOptionalPropertyTypes` off, TypeScript lets `undefined` through while the schema rejects `{ x: undefined }` on both decode and encode. A forgotten spread yields a `SchemaError` the typecheck cannot see.
- **`canonicalJson({ x: undefined })`** produced `{"x":undefined}` — invalid JSON with a different digest than `{}`; `JSON.stringify` drops that key.
- **Spread over defaults** with `undefined` overwrites a default.
- **Spread is unreadable:** a redundant one (`protocolRig.ts`, commit `3c413336aa`) and a needed one (`executions/src/protocol/stop.ts`) look identical; only reading the recipient tells them apart.

No user-facing product behaviour changes; correctness and the cost of reading code improve.

## Value roles

- **`undefined` and `?:`** — "unset", the default. A missing key and `undefined` never mean different things: JSON merges them.
- **`null`** — the value "explicitly empty": a third contract state ("clear") or SQL `NULL`.
- **`Option`** — inside Effect computations and where Effect APIs return it (`Array.head`, `Record.get`). Never placed into data fields headed for JSON, SQL, or Svelte: `JSON.stringify(Option.some(1))` yields `{"_id":"Option",...}`.
- **`exactOptionalPropertyTypes` stays off:** it introduces the reverse distinction, and each of the ~7700 `?:` would demand a spread or `| undefined`.

## What gets built

### 1. Optional schema field — `Schema.optional`

Every `Schema.optionalKey(X)` becomes `Schema.optional(X)`. Type and runtime agree: a `T | undefined` field, the caller writes `x: value`; decode and encode are single-pass; an outer `.annotate` reaches the JSON Schema.

Versus `optionalKey`, exactly this changes: decode accepts a present `undefined` (JSON never carries it), encode keeps a key holding `undefined` — `JSON.stringify` and `canonicalJson` drop it. Tests asserting a missing key after a round-trip are checked in place: whether they hold the wire contract or an outdated expectation.

The exact `Schema.optionalKey` stays where a missing key carries its own meaning: Effect's JSON codec (`Schema.toCodecJson` — the live socket speaks through `RpcSerialization.layerJson`, and `fromJsonString`) writes `undefined` as `null` and keeps the key, so `optional` would merge absence with `null` or with presence:

- fields whose inner schema admits `null` (`Schema.NullOr`, `Unknown`, `Json`): absence and `null` are different states, e.g. "don't change" vs "clear";
- patch/delta-structure fields where no key means "don't change" (`CommandFeedDelta`), and structures whose consumers check key presence or key count.

The owner assembles such an object in one place; present `undefined` fails loudly on encode instead of clearing quietly.

Rejected — a custom `omittable`: `decodeTo` from `optionalKey(S)` to `optional(toType(S))` gave the exact wire shape and a JSON Schema without `null`, but re-validated the type at every nesting level. One sample on the operator's machine, decoding a depth-8 structure: `optionalKey` 1.2 µs, `optional` 2.3 µs, `omittable` 11.6–99 µs; on top of that, an annotation outside `omittable` was lost in the JSON Schema.

Effect builds its JSON Schema from its own JSON codec (`Schema.toCodecJson`), where `undefined` ↔ `null`; so it shows `null` for `optional`, its JSON codec accepts it, but our type-codec decode does not. This covers schemas seen by models and outside consumers; the owner of that fix is decided by a separate task.

### 2. `canonicalJson` writes what `JSON.stringify` writes

An object member holding `undefined`, a function, or a symbol is dropped; such a value in an array, and an empty slot of a sparse array, are written as `null`. An audit of the owners of stored digests — sha256 worktree intent, dictionary revisions, enforcement group keys — found no input carrying such values, so stored digests do not change. Comparing two `canonicalJson` outputs only gets more correct.

### 3. The owner applies defaults

Per field with `??`: `purpose: note.purpose ?? bound.purpose`. Spread over defaults goes away; the first known case is `annotated` in `packages/executions/src/executionSpawner.ts`.

### 4. Cleaning up conditional spreads

The procedure for each site — by the object's recipient:

| Recipient | What to do |
|---|---|
| Schema with `Schema.optional`; type read by name via `??`; `JSON.stringify`; `canonicalJson` | pass directly: `x: value` |
| Overlay onto defaults | `??` at the defaults owner |
| Key iteration (`Object.keys`, `entries`, `in`, `hasOwn`), `toStrictEqual`, foreign code checking key presence | keep |

`pickDefined` and `pickPresent` leave with the last call.

### 5. Rule

The `#rule` [[49532ac2]] holds the norm in its text; there is no automatic check. The `optional-spread` check was built and run over the whole code after the cleanup wave: of 154 remaining sites, 142 proved needed (merging TanStack options over defaults, patch structures, process env, outside APIs). A gate would demand as many text-anchored permissions, and every edit to such a line would block the commit again — costing more than the check catches. The check is removed (commit `1101c593f2`).

## Order and executors

1. `canonicalJson` and defaults via `??`. First.
2. `Schema.optionalKey` → `Schema.optional`. Mechanical.
3. Spread cleanup in batches by module, following the step-4 procedure. After 2; mechanical — Sol medium/high or Muse.
4. Rule. In parallel with 2.

## Verification

The executor proves:

- the `canonicalJson` test: `{ x: undefined }` writes as `{}`, `[undefined]` and sparse arrays as `JSON.stringify` does;
- after step 2, no `Schema.optionalKey` remains in live code;
- typecheck and tests of affected packages are green on every delivery;
- every remaining conditional site has a recipient that distinguishes a missing key.

The operator verifies: product behaviour is unchanged.
