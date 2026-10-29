---
id: 01a14583-1237-7b7b-b1c3-31e015608150
title: A commit tree links an ignored directory once, even when git names it and its contents (husky `.husky/_`)
ord: 18
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1457e-b3df-721a-b633-e86cc903d6a8",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1457d-fba6-794d-ba29-1b19fa5e9133
sources:
  - kind: file
    ref: apps/tagma/server/src/workspace/checkouts/commitTrees.ts
---
`git ls-files --others --ignored --directory` for a directory with its own `.gitignore` of `*` (husky 9 `.husky/_`) names both the directory `.husky/_/` itself and each of its files. `placed` linked every record in parallel: the parent `mkdir` for `.husky/_/h` created a real `.husky/_`, and the directory symlink failed with `EEXIST` — `submit_work` in Ghostfolio refused on every landing. In the reverse race the `rm` of a nested record went through the already-placed link and deleted a file of the checkout itself.

Do: link only the outermost records; unlinking the previous run's links does not touch paths under another link being removed. Proof: `workspace/checkouts/commitTrees.itest.ts` is red before the fix with the same error, green after; a live landing on a copy of a husky repository through its own `tagma:try`.
