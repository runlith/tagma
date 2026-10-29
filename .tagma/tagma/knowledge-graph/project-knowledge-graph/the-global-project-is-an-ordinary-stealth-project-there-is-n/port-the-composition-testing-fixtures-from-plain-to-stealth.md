---
id: 01a15e64-d639-7db5-a21f-42f21599d5b4
title: Port the composition/testing fixtures from plain to stealth
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15e62-cb08-760c-894a-b2902230872a",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15e61-d6ef-7bf3-b089-23b203c2c6d6
---
Mechanical replacement in `apps/tagma/server/src/composition/testing/**`: `world.plainProject` → `world.stealthProject` (defined in `doorFixture.ts`), `storage: 'plain'` → `storage: 'stealth'`, `mode: 'plain'` storage layouts → `stealth` (including `nativeCatalog.ts`, where `gitDir` stays). The `plain` harness flags (agent profile, transport mode, `fileForm`, text) are untouched. `projectsDoor.stest.ts` proves stealth without git; tests whose point stands on a plain mirror (`graph/serving/mirrorMove.stest.ts`) are left to the spec owner and named in the report.
