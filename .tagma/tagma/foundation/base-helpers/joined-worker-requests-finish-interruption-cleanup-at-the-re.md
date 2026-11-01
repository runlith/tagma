---
id: 01a195f9-48d8-736d-aa53-be6717452be9
title: Joined worker requests finish interruption cleanup at the remote completion boundary
ord: 20
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a190c6-9088-7be5-8efe-8b03a3cb3d23
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/transcript/restedWork.ts
  - kind: file
    ref: apps/tagma/server/src/threads/journal/restScan.ts
  - kind: file
    ref: packages/utils/src/worker.ts
---
A request can survive cancellation of its waiting fiber. Callers that own paths or other resources used remotely join the request so their cleanup waits for its reply, or for the worker's close event after a transport failure. This does not cancel remote work; response-only callers can still abandon their waiter without joining it.