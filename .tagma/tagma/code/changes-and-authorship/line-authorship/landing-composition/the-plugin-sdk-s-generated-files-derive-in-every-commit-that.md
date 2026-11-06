---
id: 01a1b2e4-b3f5-7366-974a-5b56f507815f
title: The plugin SDK's generated files derive in every commit that changes the inputs the generator declares
ord: 11
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19eb2-4a56-79d0-9dbd-af67ec98a662",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a1b2d7-a737-7cbf-8298-55859ee8cc87
sources:
  - kind: file
    ref: packages/tagma/kit/generated.ts
  - kind: file
    ref: tagma.config.ts
---
With `derive.from` in place (1100916e1), the repository's `tagma.config.ts` should declare one entry for `packages/tagma/src/plugin/*.generated.*` run by `bun packages/tagma/kit/generated.ts`, so a stale SDK file can no longer land — 2f9b6e70f landed a stale `operations.generated.ts`, regenerated in 9ec1e53e1.

Done in a4d487adb: the generator's fast path. A generation that finds its files current records every file it read, keyed by the outputs' content, and the next write run answers current from it in ~0.3 s instead of 16–30 s (described in [[09039173]]). The commit-tree workspace links resolve to the tree since e9c2f2295.

Left: the config entry itself, with `from` exported from `packages/tagma/kit` (a light module the config imports: the server, app and inspection sources, `packages/**`, `bun.lock`, and `**/package.json`, `**/tsconfig.json`, `**/bunfig.toml`, sharing its resolution names with the generator) and `paths` the outputs. It lands only after the server restarts onto 1100916e1 or later: the running server decodes a `derive` entry closed (`config/decode.ts`, `onExcessProperty: 'error'`), so a `from` key before the restart would refuse every commit of the project `config-invalid`. Before landing it, measure the commit-step ceiling against a full generation in a commit tree (no record exists there for an output state no tree has generated yet).