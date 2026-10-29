---
id: 01a13bf3-f997-787a-af9c-d5b909f71f96
title: "A merge commit is judged against each of its parents: violations standing in the second side aren't new"
ord: 39
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13bef-98b2-7768-a4be-48c2027f9927",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13bee-20d6-71bd-9e16-9230c3b7c154
---
Merging a base into a worktree branch (or any merge commit in a checkout) is now judged against one first parent: everything arriving from the second side counts as the session's new violations, although they stand in the base (escaped or debt). Refused are `submit_work`, `commit_checkout` with an open merge, git hooks (staged `git_commit` court), and `record_commit` writes an escape on the merger.

What to do: the tree-court subject carries the merge's other parents (`merged`); the rule court asks the inspection against each of them too and keeps only violations new against every parent — i.e. standing only in conflict resolutions and own edits. Producers: the prepared change (`submit_work`, `check_law` over change), a checkout index commit, the staged tree (MERGE_HEAD), the landed tree (commit parents).

Proof: an owner integration test — a base with a debt-standing violation, a branch without it, merging the base into the branch lands; a violation introduced by a conflict resolution still refuses. Red → green; `bun run typecheck`; enforcement and landing tests.
