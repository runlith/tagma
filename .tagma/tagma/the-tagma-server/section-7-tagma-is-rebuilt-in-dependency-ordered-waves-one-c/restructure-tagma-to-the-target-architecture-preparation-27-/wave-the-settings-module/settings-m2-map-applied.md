---
id: 01a0e532-c89a-7bd2-9f31-86324467dc05
title: "settings M2: map applied"
ord: 2
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
    to: 01a0e532-c806-7806-be5d-983121d8b775
  - kind: waits-on
    to: 01a0e532-c891-73a5-8ec2-0df102919a95
  - kind: waits-on
    to: 01a0e532-ca72-7893-99fe-0e2dcf64b2b5
  - kind: waits-on
    to: 01a0e532-cb0e-7939-89f0-df086e97083b
  - kind: waits-on
    to: 01a0e532-cb2f-74c6-b8dd-2f9a2a66ca45
  - kind: waits-on
    to: 01a0e532-cb81-7175-a49a-cfaddab0cf5c
  - kind: waits-on
    to: 01a0e532-cba3-798b-898d-15974efb8351
  - kind: waits-on
    to: 01a0e532-cbcd-728f-87a7-8421126a802a
  - kind: waits-on
    to: 01a0e532-cbf3-72c3-a8b4-47d3266e0725
  - kind: waits-on
    to: 01a0e532-cc63-7cd6-8936-6e61092bdeb0
  - kind: waits-on
    to: 01a0e532-ccaf-7331-8d38-65646e5ffef6
  - kind: waits-on
    to: 01a0e532-cd15-715f-9e9a-7f337ef8ff1f
---
§7.2.2 milestone `M2` of the `settings` card ([[f7e0b9dd]]), with its vocabulary amendment [[8950b1dd]].

**Finish (024df2bdc1, 8b9a91c8d2):**
- **Done.** The split landed as mapped, with `SettingReaction` as the settings→graph cut.
- **Divergences:**
  - Graph's keys are in `graph/settings.ts`. The card's `graph/contract/wire/settings.ts` sits on floor 1, below `catalogs/`.
  - `settings/contract/wire/` joins floor 9 of f49f228f.
  - `purgeProject` takes `(db, projectId)`.
  - `graph/core/Settings.itest.ts` stays with graph.
- **Open, carried to M3 ([[c82bbc99]]):**
  - The threads, native-harness, external-harnesses, performance, enforcement and executions keys are still in `protocol/settings.ts`, waiting on their owners. native-harness is moving now.
  - After that, `protocol/operations/settings.ts` moves to `contract/wire/operations.ts` and the emptied file is deleted. The move is blocked because floor 9 cannot import `SETTING_KEYS` while it lives in protocol.
  - `performanceSpanMinMicros` is performance's.
  - The settings manifest has no `lifetimes`, and composition does not assemble it yet.