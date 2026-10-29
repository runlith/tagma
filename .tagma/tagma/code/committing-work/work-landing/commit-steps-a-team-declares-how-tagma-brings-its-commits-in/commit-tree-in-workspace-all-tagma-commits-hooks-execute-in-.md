---
id: 01a11332-ed8a-7bdf-a0dc-9054b2e93e70
title: Commit tree in workspace; all Tagma commits' hooks execute in it, commit_checkout moves to landing
ord: 2
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a112cb-2f89-7056-bf19-2c0fd3e50475
---
Part 1 of the spec and the "Owners and layers" section on the commit tree, `commit_checkout`, and `pull_checkout`.

Done when: `CommitTrees` in workspace with driven cleanup of vanished checkouts' trees; `submit_work`, `commit_checkout`, `pull_checkout`, and `merge_worktree` (merge) hooks run in the commit tree; `candidate` deleted; `commit_checkout` in landing publishes by `submit_work`'s path; `commitAt` and the `judgeStaged`/`recordTree` port deleted. Test through public operations: a pre-commit-framework-form hook (`git checkout -- .`) during `submit_work` and `commit_checkout` leaves another session's uncommitted lines on disk byte-for-byte, and the commit does not carry them. Working-file changes from a hook enter through `reshape` from the neighboring task — they land together with it.
