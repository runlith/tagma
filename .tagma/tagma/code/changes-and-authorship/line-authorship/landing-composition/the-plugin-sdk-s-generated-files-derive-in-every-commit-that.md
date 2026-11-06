---
id: 01a1b2e4-b3f5-7366-974a-5b56f507815f
title: The plugin SDK's generated files derive in every commit that changes the inputs the generator declares
ord: 11
tags: ["task"]
fields:
  {
    "status": "open"
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
With `derive.from` in place (1100916e1), the repository's `tagma.config.ts` should declare one entry for `packages/tagma/src/plugin/*.generated.*` run by `bun packages/tagma/kit/generated.ts`, so a stale SDK file can no longer land. Its `from` must be the generator's own input set, exported from `packages/tagma/kit` and imported by the config, never a hand-written glob list: the generator scans every server source for `ContributionPoint`, reads every `contract/wire/module.ts`, checkout-builds' `StepVerdict`, and for `ui.generated.d.ts` the window's `ui.ts` and every `.svelte` it reaches. That set covers nearly every server commit, and the generator took ~8 s here, so the generator also needs a fast path that answers "current" from hashes of its inputs before bundling. The `kit/ui.ts` fix landed in d6d8fbf48. It also waits on the commit tree resolving workspace packages to its own sources: today the tree's `node_modules` links to the checkout's, whose workspace links (`node_modules/@scope/<name> -> ../../packages/<name>`) lead back to the checkout's working files, so the generator would read uncommitted sources; spec-agents' fixer owns that in `workspace/checkouts/commitTrees.ts`.