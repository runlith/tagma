---
id: 01a127f6-4c12-7e44-9fd7-c3ef666b6be5
title: "Reflection operations are open to any project's thread: their place is Tagma's own graph, and the call's explicit project never disputes it"
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/contract/wire/operations/reflections.ts
  - kind: file
    ref: apps/tagma/server/src/invocation/admission/place.ts
---
Friction with Tagma is recorded in the project holding the server sources, always in its main checkout's graph — a caller from that project's worktree too: a reflection is a shared observation about the server, and in a branch copy neither main nor other branches would see it before merging. Reading, filing, sighting, and answering go there too, so the read cursor is shared across all places. Answering with a commit verifies reachability in the main checkout's branch: a commit not yet merged from the worktree refuses `commit-unlanded`. `everyProject` lifts the `place-mismatch` refusal when the call's explicit project differs from the reflection's place; the transport project stays the record's provenance.
