---
id: 01a194a8-e643-7c7b-91f9-247a2b8ac377
title: A declared right is judged at admission through the `Access` port, which the core never fills
ord: 42
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/contract/service/access.ts
  - kind: file
    ref: apps/tagma/server/src/invocation/admission/callers.ts
  - kind: file
    ref: apps/tagma/server/src/composition/ports.ts
---
The core declares no right, so it needs no `Access` filler and gives the port no default. A default that granted everything would quietly open every gate of a build that forgot its filler, and one that refused everything would close them. Instead the runtime checks, once the installation lifetimes of non-core modules stand, that some module filled `Access` whenever any operation, feed or creation step names a right. Without one it refuses to start. The check runs there, not in `assemble`, because a filler is a layer, and only the built context shows what a layer provides. So `admitRight` dies rather than refuses when it finds no filler: past that start check, a missing filler is a defect.

A named right is judged once per call, where the call is placed and before prepare: `admitOperation` in `contextAt` on the HTTP, socket and in-process roads, and in `nativePlace` for a native tool, before approval. The later checks before the body runs use `admitCaller`, which repeats only the caller check, so an effectful filler is asked once and cannot answer two ways within one call. Operations are judged by their declared `effect`, so `read` access admits only reads. Feeds and live protocol calls are judged in the admission service, against the door's machine context. A creation step's right is judged before anything is registered. The `right-missing` refusal carries the filler's whole answer in `right` on every road, the native tool failure's structured output included, and its unblock lines are the filler's own.