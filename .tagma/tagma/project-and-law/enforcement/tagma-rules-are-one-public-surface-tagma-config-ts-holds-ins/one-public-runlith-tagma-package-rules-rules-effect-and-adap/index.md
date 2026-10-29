---
id: 01a156d9-a73e-7045-bbfd-b089d9ef0c58
title: "One public `@runlith/tagma` package: `/rules`, `/rules/effect` and `/adapter/*` adapter doors instead of `@runlith/tagma-adapter`, only contract and descriptions"
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a12c51-8120-7250-9703-61feea5c74f4
sources:
  - kind: dir
    ref: packages/tagma
---
One public package — `@runlith/tagma`, with `/rules`, `/rules/effect` and `/adapter/*` doors. It replaces `@runlith/tagma-adapter` and carries only contract and descriptions; implementations, parsers and judgement stay in the closed server. Part of [[b6f7a4e0]].

## What stands now

`packages/tagma-adapter` (module [[ea5c74f4]]) is the model-provider adapter contract. It has its own doors with platform conditions (`./provider`, `./settings` with `browser`, bun-only `./loader`, `./conformance`, `./hostModules`), the `kit/build.ts` build releasing `dist` with d.ts and workspace-package types, `tagma.host` marks (modules the host serves an adapter from its own copy), the `@runlith/create-tagma-adapter` creator for `bun create`, and the distribution system test `kit/distribution.stest.ts`. 83 files outside `archive/` point at it. The rules contract has no public package: the `{ builtin, params }` type and the program protocol live in the closed `@tagma/inspection`.

## What will be

`packages/tagma-adapter` moves to `packages/tagma` named `@runlith/tagma`; module [[ea5c74f4]] becomes the whole package's module (root, entries, relations — via `set_module` in the work).

| Subpath | Carries | Conditions |
| --- | --- | --- |
| `./rules` | `defineConfig`, `Imports`, `Loading`, `Code`, `Files`, `Linters`, `Format`, `defineInspection`, `defineProgram`, the `Config`, `Inspection`, `FormatCommand`, `InspectionInput`, `Finding`, `Reading` types and small helpers ([[b6f7a4e0]]) | `default` — pure data, loads anywhere |
| `./rules/effect` | `Effect` | `default` |
| `./adapter/provider`, `./adapter/settings`, `./adapter/declaration`, `./adapter/loader`, `./adapter/conformance`, `./adapter/host-modules`, `./adapter/create` | the current adapter doors one to one (`./create` is the template function the server's integration test also uses) | the same conditions as now |

- Adapter doors stay separate subpaths, not one `./adapter`: their platforms differ (`settings` loads the browser, `loader` and `conformance` are Bun-only), and a door's platform is its export conditions (rule 50520d64). `tagma.host` marks are rewritten to the new subpaths.
- The creator stays a separate `@runlith/create-tagma-adapter` package: `bun create` requires it. It now takes the template with a dependency on `@runlith/tagma`.
- **One shape with one owner.** A builtin parameter shape is declared by its schema in `@tagma/inspection`. The `/rules` types are derived from it: the package build unwraps each schema's `Encoded` with the TypeScript checker (`typeToString` with `NoTruncation`/`InTypeAlias`) into a plain object type and writes it into `dist` with JSDoc from the schema's `description` annotations (the checker does not carry those, so the build reads them from the schema AST). A parameter optional with a default is declared in the schema with `withDecodingDefaultKey` — in `Encoded` that is an optional key. Prototype [[44117b6c]] unwrapped `loads`, `modules`, `size`, `swallowed-failures` and `names` this way (7.2K characters) with no single reference to `effect` or `@tagma/*`. The `/rules` functions are hand-written and only name the builtin: `(params) => ({ builtin: 'loads', params })`. Defaults are not in the SDK; the server applies them with its own schema ([[b6f7a4e0]]). So SDK and server cannot disagree on the shape.
- Tagma itself carries a copy of `/rules`: the config loader and the custom-inspection runner serve it at `@runlith/tagma/*` instead of the project's `node_modules`. The server depends on `@runlith/tagma` and takes the copy by resolving the specifier from its own code (`import.meta.resolve('@runlith/tagma/rules')` and `'@runlith/tagma/rules/effect'`): in the checkout that is `packages/tagma/src/rules/rules.ts` and `src/rules/effect.ts`, in the release their copy in the carried cut packages. Both doors import nothing at runtime; `import type` from `@tagma/inspection` is erased by the Bun transpiler. The installed package is needed only by the editor and the project typecheck.
- Runtime dependencies: `effect` is a peer, as now with the adapter, and only for `/adapter/*`; `/rules` does not depend on `effect`.
- Closed license (`"license": "UNLICENSED"` in the `dist` manifest), by the operator's word. The `@runlith/tagma` name is free, and the operator owns the `runlith` npm organization. Publishing is his step.
- Rules and adapter in one package: the operator wants one public entry point into Tagma. Subpaths do not pull each other, and `/rules` in a config loads nothing from `/adapter`.

## Acceptance

- `bun run build` in `packages/tagma` releases a `dist` whose `exports` lists exactly the table's subpaths with their conditions. No d.ts points at `@tagma/*` or at a workspace package missing from `dist`'s `dependencies` or `peerDependencies`.
- A fixture project outside the workspace installs `dist` (`file:`) and passes `bun run typecheck` with a config giving `Loading.forbid({ from, refuses })` in two fields. A typo in a parameter name or an extra field fails that typecheck.
- The carried `distribution.stest.ts`: an adapter built by the creator against `dist` loads in the server as now.
- No file outside `archive/` imports `@runlith/tagma-adapter`.
