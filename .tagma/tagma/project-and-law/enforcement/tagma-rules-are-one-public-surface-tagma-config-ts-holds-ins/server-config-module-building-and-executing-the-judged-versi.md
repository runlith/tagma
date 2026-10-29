---
id: 01a156ec-eded-78fd-a9ab-b0d145445f10
title: "Server `config` module: building and executing the judged version's `tagma.config.ts`, content-addressed cache, typed `Config`, and the `config-invalid` refusal"
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15715-b385-771d-b5c5-9faabb33927e",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a156d9-a73e-7045-bbfd-b087b6f7a4e0
  - kind: waits-on
    to: 01a156ec-eded-78fd-a9ab-b0d02782ee63
sources:
  - kind: dir
    ref: apps/tagma/server/src/config
---
New `apps/tagma/server/src/config/` module per the "One config" section [[b6f7a4e0]]. The version is read from the git tree. Build is a `Bun.build` IIFE with a plugin that serves only the version's relative files and `@runlith/tagma/*` from the SDK copy Tagma carries. Execution is a separate Tagma Bun process under `ProgramRoad`; the script goes into `node:vm` with `Date.now`, `new Date()` and `Math.random` replaced. Descriptions are decoded by the server schemas, canonical form with defaults. Cache in the git common dir: blobs of loaded paths, resolver misses, SDK version. The `config-invalid` refusal carries file, line and reason. The schema was proven by prototype [[44117b6c]]. This task does not connect the `read_config` operation and its consumers (enforcement, commit-steps): those are operation declarations, and their turn comes after [[8fa6e159]]. `set_module` writes the module card.

Proof (integration through the module port): a fixture config with a relative import yields `Config`; a second request with the same content starts no process (span); editing the imported file starts one; `fetch`, `Date.now()`, `Math.random()`, `process.env`, `node:fs` and `require('typescript')` yield `config-invalid` with a place.

## Outcome (4ed4135870)

The port is `Configs.read({ projectId, actor, root, tree })` in `config/contract/service/configs.ts`. It answers `Config | null`, where `null` means there is no `tagma.config.ts` in the tree, or refuses `GateRefusal<'config-invalid' | 'config-unstored'> | OwnGitFailed`. The `Config` shape is in `config/contract/wire/config.ts`. The module is [[8fda30d8]], the execution and cache device is [[4c5972ca]]. Wired in `composition/serving.ts`; no consumers yet.

What changed nearby:
- `packages/git` gained `treeBlobsAt`.
- Two copies of the `ProgramRoad` test double were merged into `executions/testing/road.ts`.
- `ProgramRoad` and the command rules gained a `config` tool.

Checked: `reading.itest.ts`. A relative-import chain yields `Config` with defaults in one process; the same content starts none (span `Configs.evaluate`); editing the import starts a process again. `fetch`, `Date.now()`, `Math.random()`, `process.env`, `node:fs`, `require('typescript')`, `Intl.DateTimeFormat().format()` and `Temporal.Now` yield `config-invalid` with file and line. A forgotten call and an undecodable declaration from an imported file get their place too. Also: server typecheck and `packages/git`, tests of the affected enforcement, landing and commit-steps suites, `check_law` with no violations, build via `@runlith/bundle` (SDK text baked in, evaluator bundled beside).

Not proven: Windows and the whole release — `tagma:try` was not run.
