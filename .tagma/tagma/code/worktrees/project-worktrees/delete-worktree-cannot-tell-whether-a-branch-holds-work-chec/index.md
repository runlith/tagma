---
id: 01a141f7-2acb-77ed-b53e-211c1379e1b0
title: "delete_worktree cannot tell whether a branch holds work: check-attr runs on the .git directory, not on a work tree"
ord: 21
tags: ["reflection"]
fields:
  {
    "actual": "status branch-kept, reason \"whether it holds work could not be read: fatal: this operation must be run in a work tree (-C /opt/workspaces/<project>/.git -c core.quotePath=false --attr-source=7a8e321… check-attr -z --stdin merge)\", branch.commits: [] — though the branch held 58dbcf4. git check-attr runs with -C at the shared .git, which is not a work tree, so the measurement breaks for any branch; the branch had to be deleted by hand via git branch -D.",
    "command": "delete_worktree {rootId: \"01a141f4-358f-7b4c-b211-0a8aa3aad9d1\"} (another project, the upstream-2026-08-01 worktree, one 58dbcf4 commit over base on the branch)",
    "expected": "The branch check compares it against base and answers kept with that commit in branch.commits (or deletes the branch when it holds no work)."
  }
---
Filed from another project.
