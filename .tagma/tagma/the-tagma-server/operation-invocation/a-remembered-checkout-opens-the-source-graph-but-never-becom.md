---
id: 01a12d4b-03cb-7397-8e9c-7b39b52845fa
title: A remembered checkout opens the source graph but never becomes the act's explicit cwd
ord: 5
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a12d37-cd9e-76cf-a5b7-583f49aea641
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/prepared/selection.ts
  - kind: file
    ref: apps/tagma/server/src/invocation/admission/project.ts
---
The thread's place serves as the input's starting graph copy; the absence of an explicit address stays an absence in the caller's intent. So submit_work and check_rules over change take one place from the change record: the only checkout with live lines, and for one project its main checkout. Substituting the remembered worktree into the cwd was taken as the user's choice and returned nothing for main's lines, while read_changes saw them.
