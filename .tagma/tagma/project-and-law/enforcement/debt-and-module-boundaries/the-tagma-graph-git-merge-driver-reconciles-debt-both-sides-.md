---
id: 01a10c48-d99f-7c59-9c67-3d685cb81687
title: The `tagma-graph` git merge driver reconciles debt both sides only lowered to the minimum, and leaves the rest to line merge
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/commits/graphMerge.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/commits/mergeDriver.ts
---
Tagma registers the driver where it installs the commit gate: a script in `<common-dir>/tagma/merge-driver`, `merge.tagma-graph.driver` in the local config, and a `/.tagma/**/*.md merge=tagma-graph` line in `info/attributes`. Nothing tracked in the repository changes.

The driver (`tagma merge-driver`) in each file field that reads on all three sides as an enforcement document reconciles only `debt`: a record each side only lowered (`count`) or removed gets the minimum or disappears; `value` is a measurement, and when sides diverge the smaller wins; owner and everything else follow the usual three-way. Reconciled debt is substituted into all three versions, then plain `git merge-file` runs, so a law change (strictness, inspection, owner differing on both sides, debt growth) conflicts as before.

Without installed Tagma the script just calls `git merge-file`: behaviour is the same as without a driver. A file that doesn't read as a block merges line by line. The driver doesn't touch `escaped`: diverging escapes conflict.

The script runs git on a real merge in a checkout — `merge_worktree`, pull, manual `git merge`. Worktree-merge checking reconciles debt with the same `debtReconciled` through `graphDriver`, passing the side set in one worker message: file count must not become CLI-launch count, and their YAML must not stall the server loop. Reconciled texts merge in a separate `merge-tree` in a service git dir over the same object storage; a forced text driver stops user attributes and merge config from substituting another merge. In checking, though, the script still starts where the path isn't a two-sided text edit under one mode — add/add, mode change, non-UTF-8 — and with several merge bases.

Git puts temporary `.merge_file_*` for the driver in the process cwd and removes them itself, but not when killed itself mid-driver; then the script, living to the end, sees its parent git dead and removes exactly the three files it got as arguments. Doesn't save a whole process group killed together with the script. Merging in a checkout must not run from someone else's cwd: tracked `.gitattributes` (including `merge=union`, `-merge`) are read from the working tree in cwd, and a relative path in someone else's `merge.*.driver` counts from it. In-memory merging (`mergeTreeApart`) reads attributes from the base tree (`--attr-source`), and runs git in a temp directory with `--git-dir`, so driver temp files don't land in the checkout. The exception is a repository whose config has other merge drivers: their command may be relative to the working tree, so then merging runs from the checkout, as before.
