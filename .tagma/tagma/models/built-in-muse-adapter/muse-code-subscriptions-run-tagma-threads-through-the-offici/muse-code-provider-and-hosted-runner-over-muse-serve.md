---
id: 01a19561-644d-76b1-8079-9c247761ae92
title: Muse Code provider and hosted runner over `muse serve`
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19562-2e91-73bd-ba7a-b645f8ba09ee",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a19560-3243-79c3-b6f8-cebb2a6213d4
sources:
  - kind: dir
    ref: packages/adapter-muse
  - kind: file
    ref: apps/tagma/server/src/composition/adapters.ts
  - kind: file
    ref: packages/hosted-runner/src/client.ts
  - kind: file
    ref: packages/hosted-runner/src/profile.ts
---
Build everything [[2a6213d4]] specifies except the tool bridge and HTTP serving, which its sibling task moves into the kit: the `muse-code` harness provider in `@runlith/adapter-muse` (live catalog from `model/list`, quota from `usage/changed`, CLI state and `muse login` on the Providers screen), its hosted profile, the runner (`sdk.ts` over a pinned `@muse-code/sdk`, the Muse home and its `settings.json`, the cycle on `clientSession`, asks), the kit extensions it needs (exact steer, withdrawal, session compaction, vendor permission questions, profile parameters), and the composition entry. Acceptance is the spec's.