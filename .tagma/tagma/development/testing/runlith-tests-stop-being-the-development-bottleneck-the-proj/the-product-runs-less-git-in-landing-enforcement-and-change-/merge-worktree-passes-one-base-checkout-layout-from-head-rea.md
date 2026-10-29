---
id: 01a17b33-81a8-713e-a037-c1ffee3a6db4
title: Merge worktree passes one base-checkout layout from HEAD read to hooks, publication, index pull-up, and posted-hook
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17ad9-64cb-7877-b99c-2baf36b8a082",
    "status": "closed"
  }
edges:
  - kind: implements
    to: 01a16ac4-44bf-7e0a-8178-b6ff38ef1770
sources:
  - kind: file
    ref: apps/tagma/server/src/landing/contract/service/mergeGit.ts
  - kind: file
    ref: apps/tagma/server/src/landing/merge/git.ts
---
A `merge_worktree` attempt in the base checkout reads the git layout in separate processes: `hooks` (`placesOf`), `operation` (`placesOf`), `repository` (`rev-parse --git-common-dir`), `settle` (`indexPath`), `posted` (`placesOf`), although under [[064d4461]] the layout never changes inside an act. Producer cut in `MergeGit`: the layout reads together with the base's fresh HEAD, which the attempt reads anyway, and passes by value inside the same attempt; the count of fresh HEAD checks, CAS, and refusals never changes. Measurement by call site and CPU, A B A B on the same merge files.
