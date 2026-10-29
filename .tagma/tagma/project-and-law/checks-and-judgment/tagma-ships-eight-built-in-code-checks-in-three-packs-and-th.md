---
id: 01a14c14-a11c-7ce8-9d84-633a4a0384a4
title: Tagma ships eight built-in code checks in three packs, and the project gets those fitting its stack
ord: 7
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-633b841d0f08
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-633c89123986
sources:
  - kind: dir
    ref: apps/tagma/inspection/src/packs
  - kind: file
    ref: apps/tagma/inspection/src/builtins.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/rules/reads.ts
---
**Value.** Frequent architectural norms — module boundaries, platform loading, re-export, file size, names, failures turned into success — are checked without the project's own code, deterministically and against the change's base.

**How.** A built-in check is described by an `@runlith/tagma/rules` function (`Loading.forbid`, `Imports.modules`, …) under a `tagma.config.ts` key, and `enforce_rule` and `check_rules` name that key. The catalog is `read_inspections`: one line per function whose pack the project uses on HEAD; by function name — its call signature and related types from SDK declarations, by builtin id — its parameter schema with defaults; in both cases — the fingerprint unit, reach, and refusal exits, limits on request; by key — the description with defaults and the rules naming it. `names` and `platforms` have no public function and answer only by id.

**Behaviour.**
- The js pack (JS/TS and Svelte): `loads` — what a file may not load at runtime; `platforms` — a door loads only what its platform can run; `reexports` — re-export ban. `loads`, `platforms`, and `modules` read a missing generated tsconfig through its tracked copy declared in `built`.
- The effect pack, if the project depends on `effect`: `call-services` — who may provide services to a call; `swallowed-failures` — an arbitrary failure doesn't turn into success: handling a known condition is allowed, best-effort requires an allowance.
- The architecture pack, for any project: `modules` — imports by module map; `names` — file names by meaning; `size` — line-count threshold per file.
- New is only a violation missing from the change's base.
- Language adapters exist for JS/TS with Svelte and for Python.

**Limits.** A pack the project doesn't use refuses when enabled. A file the adapter didn't read fails judgement instead of counting as clean. A read that doesn't fit the court ceiling on this machine refuses as too large.
