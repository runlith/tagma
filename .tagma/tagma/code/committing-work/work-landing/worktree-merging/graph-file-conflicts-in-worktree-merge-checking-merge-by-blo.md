---
id: 01a14a67-e04d-7266-92a4-0a4abf0acea1
title: Graph-file conflicts in worktree merge checking merge by block identity; where texts do not merge, the base's side stays, and the answer names the file
ord: 3
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a10b25-dbc8-7f63-8d9a-df4dc0df57c0
  - kind: relates
    to: 01a10c48-d99f-7c59-9c67-3d685cb81687
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/tree/settling.ts
    symbol: settledBlocks
  - kind: symbol
    ref: packages/git/src/apart.ts
    symbol: mergeTreeApart
---
The server itself writes the graph in the tree, and branches pass graph steps and dictionary installs at different times: one step rewrites the same blocks in main and in the branch, and on top main moves a block (`X.md` → `X/index.md`, when the block gains a child, with a body edit that hides the move from git's rename detection) or deletes it. Git sees modify/delete and add/add, though the knowledge does not contradict itself: a block's path is a projection of its parent and heading, identity — the `id` in frontmatter. A `merge-conflicts` refusal on such files pointed at a thread that would have to edit files agents must not write ([[c37c24a1]]).

So the graph driver in merge checking (`mergeTreeApart`, shared by the listing, `check_worktree_merge`, and `merge_worktree`) merges conflicts itself, but only when every conflicting path is its own (attribute `merge=tagma-graph`). The sides' conflict comes from the stages `merge-tree` prints, not from trees by path: a rename git paired merges the stages on the new path, and reading trees by it would have lost the block. Block parsing, move search, and result identity checking belong to the graph worker. It hands text merges to the git package as one set: the file count does not become the process-launch count. For `merge-file` compatibility this set explicitly selects Myers; already-read texts keep their oid and are not re-written into objects. Merging:
- a block one side moved (same `id` among files it added, while git paired no rename) merges three-way into the new place, and the old path goes away — leaving no two files of one `id`;
- a block both sides added onto one path merges with the base — the file of the same `id` the sides removed;
- where texts do not merge line-by-line, the base-branch side's chunks are taken (as with `merge-file --ours`); if even then the block does not read or changes `id` — its whole file. A block the base deleted and the branch changed is deleted; one the branch deleted and the base changed stays.

Merging is skipped, and all conflicts stand, when the choice would not be about one block's text: at least one non-graph path, a side unreadable as a block (including `.tagma/.archive`), one path's stages with different `id`s (two different blocks on one path or a false rename pair), or deleting the catalog's `index.md` where a merged file-child remains — a catalog without `index.md` makes the graph unreadable, and silently re-homing the child is forbidden. The way out then is `update_worktree`, which itself starts a thread in the worktree when nobody is there.

The base wins because its graph is read by every thread and steps run in it first: in [[c37c24a1]] main carried the catalog's current text, the branch an outdated one. Loss does not stay silent: `yielded` in check and merge answers names every file where the branch's change yielded — and a refusal arriving after the branch already took the base names them too, because the next check will not see them. A branch with such a file does not count as absorbed by the base (`holds`), and a tree matching the base through yielding does not refuse `already-merged`. Merging from the queue (`whenBaseFree`) answers `queued`, and its `yielded`, like `watched`, currently reaches nobody. Bringing the merge base up by graph steps, like the twin in [[491f9937]], would have removed step conflicts with no side choice, but costs a full mirror assembly per check of a pair and does not resolve true divergences.
