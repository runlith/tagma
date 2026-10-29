---
id: 01a13c03-6e15-7057-b358-6dbedd898a86
title: "A merge commit is judged against each of its parents: only a violation in neither side counts as new"
ord: 3
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a10b25-dbc8-7f63-8d9a-df4dc0df57c0
  - kind: relates
    to: 01a12cce-f608-71a0-aa2d-5d3228ba4c77
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/judging/merged.ts
  - kind: symbol
    ref: apps/tagma/server/src/enforcement/judging/trees.ts
    symbol: stagedTree
---
When completing an open git merge, a violation standing in any parent isn't new: the side where it already stands brought it — in debt, escaped or just in the tree. Only lines in neither side stay new: conflict resolutions and the session's own edits. `merge_worktree` judges new-against-base violations of the branch; the source tip confirms only accepted debt and doesn't free the branch's other violations.

Judgment against a single first parent refused every merge of a base into a lagging branch: everything arriving from the base read as the session's new violations, and base debt didn't help — in a file the first parent already has, debt doesn't apply, there only what stands in the parent itself counts as standing (apart from debt held for the session's change, [[ffbb6942]]).

**How.** The inspection still compares against one base. For a merge, each rule is judged again against every other parent — over paths changed against it, with the same debt of the branch graph; a violation stays only if it's new against every parent. When nothing changed against a side in that rule's reach, the rule finds nothing new against it.

The court keeps inspection units with their `sites` until sides merge: `count` counts independent units, not places of one unit. Repeated independent units of one fingerprint (a program may return several) can stand at different parents, and a minimum over sides would leave one of them new. So each parent removes its own volume of standing units, confirmed by line evidence of at least one of their places. An unchanged place alone frees nothing: judgment against that parent must confirm a standing violation. What remains is the volume no parent removed, no more than the minimum over sides. Before authorship and the public answer, `attributed` expands the remaining units into separate places. For a merge the answer carries no occurrences: the choice is already made over all parents, and a repeated choice over one first parent would bring back what the second side brought. Line holders read by the first parent, as before.

**Parents** come from the tree producer: the prepared change — from the open merge's MERGE_HEAD (`submit_work`, `check_rules` over change), a checkout index commit — from its own parents, `git_commit`'s staged tree — from MERGE_HEAD, a recorded commit (`record_commit`) — from its own parents.

**Boundary.** The `pre-merge-commit` hook of an auto `git merge` merge sees MERGE_HEAD not yet written: a human merging conflict-free in a terminal is judged against the first parent. An agent goes through `prepare-commit-msg`, where MERGE_HEAD already stands. Price is a second inspection pass for every rule in the reach of branch changes; non-merge landings don't pay it.
