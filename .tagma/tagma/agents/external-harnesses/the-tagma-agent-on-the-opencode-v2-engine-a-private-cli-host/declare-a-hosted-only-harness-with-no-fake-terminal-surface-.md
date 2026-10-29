---
id: 01a1647d-c3af-7af6-92e4-3d5314411167
title: Declare a hosted-only harness with no fake terminal surface and plug in the OpenCode profile
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1647e-28b1-713d-9c64-bff69ec2358f",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16472-6102-7eea-b3b2-337e6b694470
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/protocolHosted.stest.ts
---
Make terminal launch nullable as the single fact of road support, build a typed transport resolution, and move consumers over. Add the OpenCode ACP profile with no terminal argv, keeping Claude/Cursor behaviour. Two confirmed P1 reviews fixed: harnessPlace takes the accepted road, classic hook-install runs on the declared user surface. The regression `composition/testing/threads/protocolHosted.stest.ts` drives public handle.send through a real host, project checkout, and scratch: red — null directory gets `transport-unavailable`, explicit directory gets `InstallFailed: opencode declares no account layer`; green — both get recorded running/owned execution and prompt, 2/2 in 13.38 s. Terminal/model/account contracts: 19/19.
