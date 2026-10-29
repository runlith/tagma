---
id: 01a0e532-cd36-782a-8b69-b402be9c66a4
title: "external-harnesses N: narrowed"
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e5ce-0070-75a0-8f80-bc9315d3b0c5",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0e470-ffc4-7261-8631-2ffbf7e0b9dd
  - kind: waits-on
    to: 01a0e532-c83e-75dc-a3c4-533ae1411479
  - kind: waits-on
    to: 01a0e532-c977-7ae5-ba79-c0cedb416adf
  - kind: waits-on
    to: 01a0e532-ca7c-7f96-97dd-247ba9fd89de
  - kind: waits-on
    to: 01a0e532-cac4-7f8e-8f52-7d4845779ef0
  - kind: waits-on
    to: 01a0e532-cb8a-7bef-9a85-b3ffc595c5f9
  - kind: waits-on
    to: 01a0e532-cc6c-73df-a111-c28429ce4645
  - kind: waits-on
    to: 01a0e532-ccc1-799b-82bd-bde34047bdcd
  - kind: waits-on
    to: 01a0e532-cd2d-71a0-995a-180e3593792f
  - kind: waits-on
    to: 01a0e532-cd48-7c09-999e-8e0c98746485
  - kind: waits-on
    to: 01a0e532-cd6e-7a04-85b9-0ab5dd5ad950
  - kind: waits-on
    to: 01a0e532-cf0f-7514-a91c-221fa544b85f
---
§7.2.2 milestone `N` of the `external-harnesses` card ([[f7e0b9dd]]), with its vocabulary amendment [[aa1b0681]].

Re-owned from native-harness M3 ([[fae4395f]], afd5b80237): `native-harness → external-harnesses` in `rows/native.ts` (`insertSession`, `sessionOf`) leaves when the external facet is written through `Harness.born` at the keyed birth (done: `insertSession` now sits with the `external_session` table in `threads/store/harnessFacet.ts`).

Narrowed (56d07c70a3): entries are `contract/`, the manifest, `contribution.ts`, `cli.ts`, `settings.ts`, `assembly.ts` (the one composition builds the session store, observations, metadata, reports, driver, adoption and births through), the install/setup contributions and `operations.ts`, `adapter/hookFormat.ts`, and `testing/`. Composition reaches only declared entries (a923c9fcab): the session lookups moved to `threads/store/sessionLookups.ts`, the hook road budget to `contract/wire/call.ts`, fixtures build through `testing/floor.ts`, and the contribution files it fills ports from (`birth/installed.ts`, `rollout.ts`, `sessionResolution.ts`, `sessions/speech.ts`, `titles.ts`) are entries. Nothing of this module's own debt remains; what is left standing on external is graph's two sessionStart tests, native-harness's `capabilities/threads.ts` and http's `door.ts`, each owned by its own N. The waits-on edge to composition M2 ([[7139e341]]) was removed because composition no longer crosses into this module; graph's two sessionStart tests moved to `composition/testing/graph/`, and the native-harness (`capabilities/threads.ts`, [[471e545e]]) and http (`door.ts`, [[c294eb1d]]) crossings stand as debt on those owners' tasks.