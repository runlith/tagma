---
id: 01a16e2d-f28c-765e-bf68-490a5980c7c8
title: A fast merge adapter keeps repository facts, not emulated git commands
ord: 5
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/landing/contract/service/mergeGit.ts
  - kind: file
    ref: apps/tagma/server/src/landing/testing/memoryMerges.ts
---
Comparison and replay results are set as fixture facts: their computation stays with real Git, and unit tests the admission, publication and queue policy. A shared conformance checks ref transitions, index preservation, working edits and interrupted-merge reads on both adapters; the build injects the real adapter through `MergeGit`.
