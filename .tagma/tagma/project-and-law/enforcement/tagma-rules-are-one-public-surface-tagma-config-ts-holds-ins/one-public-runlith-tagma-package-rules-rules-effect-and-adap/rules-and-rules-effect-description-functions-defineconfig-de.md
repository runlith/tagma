---
id: 01a156ec-eded-78fd-a9ab-b0d02782ee63
title: "`/rules` and `/rules/effect`: description functions, `defineConfig`, `defineInspection`/`defineProgram`, types from builtins' schemas with defaults"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a156ed-838a-7ce7-932b-258aa4ee7b57",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a156d9-a73e-7045-bbfd-b089d9ef0c58
  - kind: waits-on
    to: 01a156ec-eded-78fd-a9ab-b0cf42ba43b5
---
Per [[b6f7a4e0]] and [[d9ef0c58]]: the `./rules` and `./rules/effect` subpaths of the `@runlith/tagma` package — `defineConfig`, `Imports.modules`, `Loading.forbid`, `Code.noReexports`, `Files.maxLines`, `Linters.*`, `Format.command`, `defineInspection`, `defineProgram`, `Effect.noSwallowedFailures`, `Effect.servicesOnlyIn` and the contract types. In `@tagma/inspection`, parameters that the spec gives defaults are declared with `withDecodingDefaultKey`, and the server substitutes the default when decoding. The package build unwraps schemas into object types with JSDoc from annotations — the approach proven by prototype [[44117b6c]]. Operation declarations are untouched.

Proof: a fixture project outside the workspace installs `dist` and typechecks with `Loading.forbid({ from, refuses })`, while a typo in a parameter fails it; no `dist` d.ts points at `effect` or `@tagma/*`; the `@tagma/inspection` declaration tests are green.

## Outcome (7a4454aedc, 6cbe344711)

The doors are `packages/tagma/src/rules/rules.ts` and `src/rules/effect.ts`. Builtin parameter types, `Finding`, `Facts`, `Concern` and `FactKind` are declared there through `import type` from `@tagma/inspection`, and `kit/rules.ts` unwraps them at build into object types in `dist/rules/*.d.ts` with JSDoc from the runtime schemas' `description`, refusing the build if the rules doors' d.ts still point at `effect` or `@tagma/*`. Defaults (`withDecodingDefaultKey`) stand in `loads`, `modules`, `reexports`, `size`, `swallowed-failures` and `call-services`; stored documents stay complete because encode passes the value through. The input shape these parameters show through `read_inspections` and `unblock` now writes `base?:`. Checked: package typecheck, `@tagma/inspection` and server typechecks (errors left only in someone else's unfinished work), all `@tagma/inspection` tests, enforcement and server-module itests, the package's `test:system`: a NodeNext fixture with `Loading.forbid({ from, refuses })` typechecks, and a `refuse` typo fails it. The reviewer found a `./rules` import without extension in d.ts (broke NodeNext) and a forgotten `conditions` default at `modules`; both fixed in 6cbe344711.
