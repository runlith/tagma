---
id: 01a18d95-af14-732f-89e4-44b42bd14e00
title: "ModelAccess and HarnessAsides reach only their doors: transports publish copies through ThreadCopies, composition binds the asides"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18d8f-33f7-723b-a21f-22aba0093285",
    "status": "in_work"
  }
edges:
  - kind: implements
    to: 01a18cbf-9775-75eb-a4a1-6542bcec10b7
  - kind: relates
    to: 01a18d50-f2c0-700f-86f0-c72a93f04f23
---
The runtime half of the ask door's import boundary. Native kernel, threads assembly and ending, and the ACP driver stop importing `HarnessAsides`. Transports publish, settle and forget warm copies through a `ThreadCopies` port that has no ask and no copy read. Recap watches copies through the `ThreadAsks` door, and composition binds both tags from the kernel's asides. The start card reads the context window from the provider catalog instead of `ModelAccess`, and `AccountCredentials` leaves `access.ts`. The providers and threads cards restrict `access.ts` and `asides.ts` with `for:`.