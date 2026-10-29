---
id: 01a11bd7-b4de-76ed-9c91-1a356617160f
title: A graph refusal does not cut the project off from chats
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/invocation/admission/project.ts
  - kind: file
    ref: apps/tagma/server/src/invocation/admission/services.ts
---
Threads need the project's identity whether or not its graph is readable. Admission keeps the open refusal separate from the found project: CurrentProject stays available, while GraphCall and routed graph services return the original refusal. A failed lookup of the project itself still refuses admission; addressing by block name requires a readable graph.
