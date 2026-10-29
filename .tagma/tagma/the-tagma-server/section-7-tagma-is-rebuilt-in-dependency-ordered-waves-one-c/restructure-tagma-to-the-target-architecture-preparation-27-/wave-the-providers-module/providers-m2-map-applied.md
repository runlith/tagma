---
id: 01a0e532-c8fe-7e28-a96f-0163155e2b41
title: "providers M2: map applied"
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
    to: 01a0e532-c8f3-72ab-9746-e3aa803fe207
---
§7.2.2 milestone `M2` of the `providers` card ([[f7e0b9dd]]), with its vocabulary amendment [[8950b1dd]].

Finished with three items left to their owners:
1. Registering the `sign-in` verb in `providers/cli.ts` waits for the platform verb contract to gain a server client and a manifest `verbs` slot. That work belongs to cli M1 [[2a63241a]], together with platform. Until then, `providers/cli/signIn.ts` stays as it is and imports no cli code.
2. Declaring the quota refresh (`providers/quota/refresh.ts`) as a pass waits for platform's pass contract (`Manifest.passes`), owned by platform M3 [[cfbcbd60]].
3. The credential snapshot participant (`providers/credentials/snapshot.ts`) lands with providers M3 [[a91f7b54]], once `platform/contract/service/snapshots.ts` is at HEAD.