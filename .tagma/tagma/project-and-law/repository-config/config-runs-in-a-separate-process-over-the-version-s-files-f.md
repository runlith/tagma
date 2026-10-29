---
id: 01a1573a-1f27-70a2-b2b0-2f164c5972ca
title: Config runs in a separate process over the version's files from the task, and a cache hit is proven by comparing blob ids with no process
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/config/evaluate.ts
  - kind: file
    ref: apps/tagma/server/src/config/profile.ts
  - kind: file
    ref: apps/tagma/server/src/config/reading.ts
---
The execution process does not read git: the server puts the version's file texts and the paths missing from it into the task. Only the build resolver in the process decides which file a specifier becomes. For a path the task says nothing about, it answers `wanted`, the server reads the candidates from the tree and starts the process again. So an import chain costs no process per level, the server predicts relative imports up front via `Bun.Transpiler.scanImports` and reads their candidates in one batch. Prediction only feeds files: an extra file is harmless, while resolution and refusal stay with the process.

Three things hold determinism:
- **Launch.** `env -i TZ=UTC`, `--config=/dev/null --no-env-file`, the working directory is the evaluator's own directory and `policyRoot` is the checkout. Without this, `preload` from the working tree's `bunfig.toml` and `.env` would run before the sandbox, and the machine timezone would change `Date.parse` and local time.
- **`node:vm` context.** Refusals stand in for `Date.now`, `Date()` and argument-less `new Date()`, `Math.random`, `Temporal.Now.*`, as well as `format` and `formatToParts` of `Intl.DateTimeFormat` when no date is passed.
- **Serialization.** The result is taken with `JSON.stringify` and a replacer that refuses a function, a symbol and a non-plain object (e.g. `Promise`). Otherwise JSON would silently drop a forgotten `Format.command` call or an async default export, and the config would pass empty.

The cache entry holds the profile — `Bun.version` and the texts of the evaluator, `sources.ts` and the SDK doors — the blob of every loaded path and paths the resolver tried and missed. A hit is verified with one tree walk over these paths: no process starts. The profile includes the evaluator so a fixed isolation leaves no earlier results in force. Entries (up to 16) live in `<git common dir>/tagma/config.json`, so worktrees share them. An unreadable file format counts as an empty cache, and a write failure is `config-unstored`, not a silent skip.

The profile reads the SDK door texts from disk via `RULE_SOURCES` from `@runlith/tagma/sources`: the doors are named there as `new URL('./rules.ts', import.meta.url)` and `new URL('./effect.ts', import.meta.url)`, and cut, like `evaluate.ts`, assembles them next to the server bundle. A text import (`with { type: 'text' }`) does not fit: Bun.build merges it with the code import of the same file, and the server also loads `@runlith/tagma/rules` as code, so in the bundle the text became a namespace without `default`. `config/bundled.itest.ts` proves this on a minified bundle. An unreadable profile file gives a `config-unrunnable` refusal with the path and the "rebuild Tagma" exit.

Unproven: Windows — launch goes through `/usr/bin/env`, while `ProgramRoad` still starts `/bin/sh`.
