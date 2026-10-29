---
id: 01a14a51-5263-77e3-bd28-be14861b4790
title: A worktree merge conflicting only in graph files goes in one merge_worktree act; update_worktree with no thread in the worktree starts it itself
ord: 25
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14a44-03fb-779e-bffe-120f45145bab",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14a43-13c5-7972-a767-da72c37c24a1
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/worktreeUpdates.ts
  - kind: file
    ref: apps/tagma/server/src/worktrees/listing/mergeChecks.ts
  - kind: symbol
    ref: packages/git/src/apart.ts
    symbol: mergeTreeApart
---
`merge_worktree` of a project with the graph in the tree (team storage) refuses `merge-conflicts` when `git merge-tree` finds conflicts only in `.tagma` files, and points at `update_worktree`, which without a thread in the worktree refuses `no-lead-thread`: no one-act way out. The [[c37c24a1]] case: a graph step (`note` → `explanation`, catalog `code-project` → `software-development`) passed in main and in the branch at different times; on top main moved block `X.md` → `X/index.md` with a body edit, deleted another block, and adopted the catalog's new text. Git sees modify/delete and add/add, though the code merges clean.

Do:
- Merge checking (`MergeChecks`, the same `merge-tree` as the listing, `check_worktree_merge`, and `merge_worktree`) merges graph-file conflicts itself, by block identity: a block moved by one side merges three-way into the new place; where text merging is impossible, the base branch's side is taken. A conflict in even one non-graph file refuses as before, by every path.
- The check and merge answer names the graph files where the branch's side yielded to the base, so the knowledge loss shows.
- `update_worktree` with no thread in the worktree is no dead end: the act starts a thread in the worktree itself and hands it the update.

Start at `apps/tagma/server/src/worktrees/listing/mergeChecks.ts`, `packages/git/src/merge.ts#mergeTreeApart`, `apps/tagma/server/src/enforcement/commits/graphMerge.ts`, `apps/tagma/server/src/threads/worktreeUpdates.ts`.

Proof: an integration test of the public merge contract (`finishing.merge`) on real git — a worktree conflicting only in graph files merges in one call, the merged tree's graph reads with no identity duplicates; a code conflict still `merge-conflicts`. Red before the change, green after.

Done in 80ac76fa47 and cb22d5f2e9; the device — [[bf0acea1]]. Not proven: a live merge on a real worktree and a `tagma:try` instance not run; merge-failure refusals (orphan `index.md`, two blocks on one path) verified by reading code, not by test; `id` duplicates from clean additions by both sides, which git merges with no conflict, still not caught, as before. Merge warnings from the queue — [[d643a7b9]].
