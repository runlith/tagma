---
id: 01a0e532-cf2d-7a22-bd2f-f3c1de27db64
title: "composition M1: contract and runtime ready"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e816-300f-732c-a1c2-61a63ba56cdd",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0e470-ffc4-7261-8631-2ffbf7e0b9dd
  - kind: waits-on
    to: 01a0e532-c833-7e69-8475-95bc0f489891
  - kind: waits-on
    to: 01a0e532-c85d-77a2-b8b1-9e87acb22feb
  - kind: waits-on
    to: 01a0e532-c891-73a5-8ec2-0df102919a95
  - kind: waits-on
    to: 01a0e532-c8f3-72ab-9746-e3aa803fe207
  - kind: waits-on
    to: 01a0e532-c949-7ee7-90f4-b9199b5cb879
  - kind: waits-on
    to: 01a0e532-c9df-7dd6-b6d0-459b5b1efac5
  - kind: waits-on
    to: 01a0e532-ca72-7893-99fe-0e2dcf64b2b5
  - kind: waits-on
    to: 01a0e532-ca99-7263-bb8c-16e15cb8a11e
  - kind: waits-on
    to: 01a0e532-cabb-7020-924a-237a4954809f
  - kind: waits-on
    to: 01a0e532-caea-7290-bfc2-a15d87daed90
  - kind: waits-on
    to: 01a0e532-cb0e-7939-89f0-df086e97083b
  - kind: waits-on
    to: 01a0e532-cb2f-74c6-b8dd-2f9a2a66ca45
  - kind: waits-on
    to: 01a0e532-cb5a-74e9-a6cf-8f09762eb8cb
  - kind: waits-on
    to: 01a0e532-cb81-7175-a49a-cfaddab0cf5c
  - kind: waits-on
    to: 01a0e532-cba3-798b-898d-15974efb8351
  - kind: waits-on
    to: 01a0e532-cbcd-728f-87a7-8421126a802a
  - kind: waits-on
    to: 01a0e532-cbf3-72c3-a8b4-47d3266e0725
  - kind: waits-on
    to: 01a0e532-cc14-7576-bcab-e726b081c218
  - kind: waits-on
    to: 01a0e532-cc3d-7f0f-85d5-717a64fe5ad3
  - kind: waits-on
    to: 01a0e532-cc63-7cd6-8936-6e61092bdeb0
  - kind: waits-on
    to: 01a0e532-cd15-715f-9e9a-7f337ef8ff1f
  - kind: waits-on
    to: 01a0e532-cd3f-7b6c-9add-c2ccefbe85a5
  - kind: waits-on
    to: 01a0e532-cd64-7768-8533-d82bcb39fb3f
  - kind: waits-on
    to: 01a0e532-cd8e-739e-9e53-48519485548f
  - kind: waits-on
    to: 01a0e532-cecc-7311-9472-c7042a63241a
---
Closing state (wave-providers): every waiting item above has landed. `MODULES` holds every module that contributes something, including `cli` (its verbs); `http` and `socket` have no contributions of their own (their operations, feeds and routes are their owners'), so they declare no manifest. The operations, bodies, settings, doctrine sections, feeds/LiveRpc, CLI verbs (`Manifest.verbs`, bindings by module id in `composition/cli/verbs.ts`) and the socket act verbs (`FeedDeclaration.performs`) are collected from the manifests; `manifestTables.itest.ts` asserts every table declared in source is claimed by exactly one manifest. `protocol/operations`, `SETTING_KEYS` and the doctrine owner map are gone.

§7.2.2 milestone `M1` of the `composition` card ([[f7e0b9dd]]), with its vocabulary amendment [[aa1b0681]].

## Central enumerations — what each still waits on

`composition/modules.ts` is the ordered list of every static module manifest. `composition/manifest.ts` derives from it. The floor rule [[f49f228f]] puts `composition/` on the top floor, so a new `X → composition` import is refused. The ones standing at the branch head are removed by M2.

Retired:
- `MACHINE_REPORTS` (`composition/reports.ts`) → `REPORTS`, derived from the manifests' `reports` (`d5354d5d41`).
- The hand list of doctrine contributors in `composition/doctrine.ts` → `SECTIONS`, derived from the manifests' `sections` (`d5354d5d41`).

Waiting:
- **Modules outside `MODULES`:** catalogs, power (`power.ts` is a plain object, not a manifest), enforcement (a factory manifest), performance, landing, threads, external-harnesses, invocation, http, socket, cli. Each joins when its static manifest lands. A lifetime that needs arguments stays out of the manifest and is called by the assembly, as `executionsLayer` and `artifactsLayer` are.
- **`OPERATIONS`, `OPERATION_IDS`, the `OperationId` union and the socket-only, operator-only and perform-only sets** (`protocol/operations/index.ts`). Contributors still declared in `protocol/operations/`:
  - `agents`, `session` → threads;
  - `enforcement` → enforcement;
  - `finishing` → landing;
  - `graph` → graph (its pairs are already in the manifest);
  - `harness` → external-harnesses;
  - `mcp` → mcp;
  - `process` → installation;
  - `settings` → settings;
  - `working` → workspace and worktrees;
  - `doctrine` → invocation.

  Then K3 moves the union to `composition/manifest.ts` and keeps the browser's `OperationId` type export. `OPERATION_REGISTRY` (`composition/registry.ts`) and `start`'s managed-setting check follow it.
- **`OPERATION_BODIES`** (`operations/index.ts` → `composition/bodies.ts`). Bodies still in `operations/`:
  - `agents`, `session` → threads;
  - `harness`, `installStatus` → external-harnesses;
  - `process` → installation;
  - `projects` → projects and graph.

  The move also waits on invocation M1: `invocation/perform.ts` must take the bodies as an argument instead of importing `bodyOf`.
- **`SETTING_KEYS` and `SETTING_SECTIONS`** (`protocol/settings.ts`), and the hand merge in `composition/settings.ts`. Only mcp and native-harness declare their keys in their manifests. These still come from named lists:
  - graph (`GRAPH_SETTING_KEYS`);
  - threads (`THREADS_SETTING_KEYS`);
  - executions;
  - external-harnesses;
  - worktrees;
  - enforcement;
  - power (`power.settings`).

  The remainder waits on settings M2.
- **Doctrine registry** (`doctrine/sections.ts`): the `CONTRIBUTED_SECTIONS` id→owner map and the non-contributed `SECTIONS`. These wait on threads M1, whose `ThreadDoctrine` registry is assembled from contributions. They also wait on the owners that contribute their own sections: installation (`wiring-a-repository`), mcp (`mcp-servers`) and invocation (`the-operations`).
- **CLI verbs** (`composition/cli/verbs.ts`, `VERBS`) wait on cli M1 and on each owner's verb descriptors in its manifest (K3).
- **Feeds and endpoints:** the socket and HTTP route lists wait on socket M1 and http M1 (K2/K3). Only providers and change-record declare `feeds` in their manifests so far.
- **Tables:** there is no central list, because `drizzle.config.ts` scans for `sqliteTable`. M3 adds the check that every table is claimed by exactly one manifest.
