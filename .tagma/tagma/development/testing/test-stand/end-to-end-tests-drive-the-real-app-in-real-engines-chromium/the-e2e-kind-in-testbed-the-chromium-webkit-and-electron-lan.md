---
id: 01a18353-fa93-749b-8594-f14bfdfb86f9
title: The e2e kind in testbed, the Chromium, WebKit and Electron lanes and the in-process server world, proven by a first thread flow
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18355-1f5a-7c71-81cc-5e1fd94b32d8",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a18353-4910-704e-8b7d-d7f17111dc21
sources:
  - kind: dir
    ref: packages/testbed
  - kind: file
    ref: .github/workflows/test.yml
  - kind: file
    ref: apps/tagma/server/src/composition/testing/pageWorld.ts
---
Parts 1, 2, 3 and 7 of [[7111dc21]]: the `*.e2e.ts` kind and `test:e2e` in testbed, browser fixtures per lane with their own profiles and the mock keychain, failure artifacts in the run report; the e2e world serving the door world and the built app over real HTTP and WebSocket, seeded through product operations with a scripted model; the first flow (open a thread, send, the scripted reply streams, scroll); the CI jobs. The fixture API is the contract the feed stand builds on.