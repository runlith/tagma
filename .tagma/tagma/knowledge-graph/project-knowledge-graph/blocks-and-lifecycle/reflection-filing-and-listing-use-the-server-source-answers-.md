---
id: 01a127f6-4c12-7e44-9fd7-c3ef666b6be5
title: Reflection filing and listing use the server source; answers use the reflection's main graph
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/contract/wire/operations/reflections.ts
  - kind: file
    ref: apps/tagma/server/src/graph/serving/sourceProject.ts
  - kind: file
    ref: apps/tagma/server/src/invocation/admission/place.ts
  - kind: file
    ref: apps/tagma/server/src/invocation/nativePlace.ts
---
Friction is filed, sighted and listed in the project serving the graph that the repository holding the server's code carries, found by that graph's root: a build whose code lies in another clone of the core — a distribution's submodule — files into the registered core project, never into the distribution, and the `tagma` alias resolves the same way. Where no project serves that graph, the project holding the server's directory or the checkout its installation was cut from takes its place. Always in its main checkout's graph, so the observation and read cursor are shared across branches. Answering and withdrawing an answer use the named reflection's project and its main checkout, including when the reflection moved to another project; a commit answer verifies reachability in that checkout's branch and refuses `commit-unlanded` for an unmerged worktree commit, and a `by` block standing only in a worktree's copy refuses naming that copy and `merge_worktree`. These operations accept threads from any project without treating the caller's project as a place mismatch; the filing retains the transport project's provenance. Filing and answering are fixed-place writes: routing them to their graph does not enroll the caller in that project's working places or require its law. The law gate remains on ordinary project work.