---
id: 01a12c9d-166c-7323-a7c1-79015af1c386
title: The checkout selects the graph copy for all its blocks and tags
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/operations/answers.ts
  - kind: file
    ref: apps/tagma/server/src/graph/tree/conflicts.ts
  - kind: file
    ref: apps/tagma/server/src/invocation/admission/project.ts
---
In team storage the graph follows the checkout's git branch: a call with the thread's account uses its working checkout's copy by default, and an explicit cwd or branch picks another. Changes land in the main checkout by merging the branch. Naming a block in the caller's project keeps the caller's checkout: a detached stealth checkout stays read-only even when it reads the live main graph. The write answer names the project, checkout, graph tree, and the copy's branch in `graphCopy`; the branch comes from the project's checkout list, null for the main copy. `resolve_graph_conflict` checks files and structure before changing the index and stages the verified snapshot in the team checkout. The answer names the remaining code conflicts in `remaining`; the landing merge commit belongs to the repository landing operation.
