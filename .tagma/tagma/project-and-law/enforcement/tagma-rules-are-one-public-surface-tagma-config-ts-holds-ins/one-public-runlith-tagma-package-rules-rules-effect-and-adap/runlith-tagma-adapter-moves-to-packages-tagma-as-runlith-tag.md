---
id: 01a156ec-eded-78fd-a9ab-b0cf42ba43b5
title: "`@runlith/tagma-adapter` moves to `packages/tagma` as `@runlith/tagma` with `/adapter/*` doors"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a156ed-838a-7ce7-932b-258aa4ee7b57",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a156d9-a73e-7045-bbfd-b089d9ef0c58
---
Move `packages/tagma-adapter` to `packages/tagma` named `@runlith/tagma`; adapter doors become the `./adapter/provider`, `./adapter/settings`, `./adapter/declaration`, `./adapter/loader`, `./adapter/conformance`, `./adapter/host-modules` subpaths with the same conditions, `tagma.host` marks on the new subpaths, the `@runlith/create-tagma-adapter` creator with a dependency on `@runlith/tagma`. All 83 files importing `@runlith/tagma-adapter` are translated by hand (rule 82f10fbb); `bun install` writes the lockfile. `set_module` carries the [[ea5c74f4]] module card. Start from `packages/tagma-adapter/package.json`, `kit/build.ts`, `kit/distribution.stest.ts`.

Proof: `bun run build` yields a `dist` with the `exports` map from [[d9ef0c58]]; the carried `distribution.stest.ts` is green; affected packages' typecheck is green; no file outside `archive/` imports `@runlith/tagma-adapter`.

## Outcome (cfab91597b)

Adapter doors are `./adapter/{provider,settings,declaration,loader,conformance,host-modules,create}`: `./adapter/create` was carried by the old package too, and the server's integration test imports it, so it entered the spec table. The `exports` map in `dist` is derived by the build from the package manifest's `exports` with the same conditions. In the platforms rule's parameters the loader path is rewritten to `packages/tagma/src/adapter/loader.ts`. Modules are `@runlith/tagma` (`packages/tagma` root) and `@runlith/tagma-kit` (`packages/tagma/kit`). Checked: `bun run build`, `test:system` (`distribution.stest.ts`), package typecheck, server host-module and adapter-registry tests. `tagma:typecheck` errors stand only in someone else's unfinished work (the `place` operation field, terminal layouts).
