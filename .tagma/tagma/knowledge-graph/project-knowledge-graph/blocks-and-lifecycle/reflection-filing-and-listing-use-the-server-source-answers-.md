---
id: 01a127f6-4c12-7e44-9fd7-c3ef666b6be5
title: Reflection filing and listing use the server source; answers use the reflection's main graph
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/contract/wire/operations/reflections.ts
  - kind: file
    ref: apps/tagma/server/src/invocation/admission/place.ts
---
Friction is filed, sighted and listed in the project holding the server sources, always in its main checkout's graph, so the observation and read cursor are shared across branches. Answering and withdrawing an answer use the named reflection's project and its main checkout, including when the reflection moved to another project; a commit answer verifies reachability in that checkout's branch and refuses `commit-unlanded` for an unmerged worktree commit. These operations accept threads from any project without treating the caller's project as a place mismatch; the filing retains the transport project's provenance.