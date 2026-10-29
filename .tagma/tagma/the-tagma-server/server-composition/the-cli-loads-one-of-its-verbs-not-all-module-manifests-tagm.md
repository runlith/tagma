---
id: 01a16e37-8d17-7b78-bc1a-de5bc4fdb83b
title: "The CLI loads one of its verbs, not all module manifests: `tagma check` from the git hook costs ~1 s per commit"
ord: 24
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16ded-dc3b-7bb7-abeb-578f9f565e34",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16dee-2f94-741a-9871-e27ccddeaa11
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/cli/verbs.ts
---
**What.** `tagma check --gate`, which the commit-gate git hooks run on every `git commit` (`pre-commit`/`prepare-commit-msg`, and after landing also `post-commit` with `--landed`), costs ~0.75 s CPU and ~1 s wall per launch, though it makes one HTTP call to the server. Measurement of 2026-10-24, Apple M2 Max under load, one sample: `TAGMA_SERVER_URL=http://127.0.0.1:9 bun apps/tagma/server/src/composition/entries/cli.ts check --gate` — user 0.47–0.51 s, sys 0.26–0.28 s, real 0.95–1.01 s.

**Why.** `composition/entries/cli.ts` lazily loads `composition/cli/verbs.ts`, but it statically imports `MODULES` from `@tagma/server/composition/modules` plus `COMPOSED_VERB_BINDINGS`: to assemble `TAGMA_VERBS` it calls `module.verbs?(…)` of every manifest, and a module manifest pulls its operations and layers. Walking runtime imports from `cli.ts` (native `Bun.Transpiler.scanImports`, as in `enforcement/eventLoop.itest.ts`) reaches ~3750 files — nearly the whole server graph (~3730 from `composition/server.ts`).

**Goal.** Launching one verb loads only that verb and what it calls: the manifest declares the module's verbs so that listing and selecting them does not load the module's code (e.g. a separate lightweight verbs entry in the manifest or lazy `verbs`), and composition assembles them without importing manifests whole (rules `edea5454`, `e090f46d`). The user pays milliseconds for the commit gate, not a second per commit; CLI-driving tests (`enforcement/commitGate.itest.ts` — ~40 launches, ~30 s CPU of its cost) get cheaper the same way.

**Acceptance.** `tagma check --gate` with the server unreachable loads no more than a few hundred files and costs an order of magnitude less CPU than now on the same machine; `tagma op …` and other verbs work as before.

**Landed** (`eb21278f47`, `b93ca2b051`). The CLI builds the verbs table from `VERB_MODULES` — lightweight module declarations, the same functions standing in the manifests' `verbs` ([[3bf7e3af]]); `composition/cli/verbs.test.ts` reconciles the table with the developer and release build manifests by id, order, and function identity, and checks the `TAGMA_VERBS` set is unchanged. The checkout-builds and release-channel verb factories moved to their own `verbs.ts`. The CLI door signs the call from `external-harnesses/contract/wire/sessionVariables.ts` instead of the whole harness-adapter table with vendors; vendor rows take the variable name from there, `table.test.ts` checks the match.

**Measurement** (Bun, `require.cache` at process exit; CPU — user+sys `time -p`, one sample per point, machine load differed per point): before — 1171 modules, ~1.0 s CPU; after — 452 modules, 306 of them `effect` itself, ~0.35–0.45 s CPU (without the measurement preload ~0.3 s, wall ~0.25 s).

**Remaining.** ~140 non-effect modules — contracts `check` itself uses: the enforcement operations and findings catalog, refusals, the inspections catalog, installation leases from `entries/cli.ts`. A client of health and operations groups alone removed only 4 modules (measured in [[279e6737]]) and was not built. The verbs table is a second list next to `MODULES`, like `composition/coreCatalog.ts` next to `core.ts`; one shared lightweight module declaration for both would require lazy `lifetimes` in every manifest.
