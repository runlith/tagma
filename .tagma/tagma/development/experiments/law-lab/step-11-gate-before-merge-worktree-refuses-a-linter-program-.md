---
id: 01a1615e-6cff-7d5f-a6f5-0f118a58c334
title: Step 11 · Gate before merge_worktree refuses a linter-program violation when the merge is called by a thread from another home
ord: 28
tags: ["experiment"]
fields:
  {
    "status": "done",
    "verdict": "confirmed"
  }
edges:
  - kind: validates
    to: 01a14c14-a11c-7ce8-9d84-633588b4c33c
  - kind: validates
    to: 01a14c14-a11c-7ce8-9d84-633b841d0f08
---
## Hypothesis

The gate before `merge_worktree` judges the merged tree with a linter program and refuses a new violation when the merge is called by a thread from another home (runlith) — the path fixed by `92ef53d4b8` ([[4d5c12f1]]).

## Setup

- law-lab: rule [[4e5d1446]] (ESLint `no-console`) switched to a `merge_worktree before` trigger only (revision `cca1d7b3efb3`), so that the violation lands on the branch. Worktree `merge-gate-probe` off `main` (`create_worktree`), the graph commit carrying the trigger brought into the branch fast-forward.
- The caller is the researcher thread with a runlith home (project 5).

## Observation

1. The first `submit_work` in the new worktree: `inspection-failed` — "eslint: Cannot find package 'eslint' imported from …/merge-gate-probe": the worktree has no `node_modules`, `worktrees.setupRun` is empty. After a manual `bun install`, the commit `dddfe6b6c8` with `console.log` landed (no submit gate stood in the branch's graph yet).
2. `merge_worktree` from the runlith thread: `refused[rule-violated]`, `money.ts:8 Unexpected console statement`, "4e5d1446 ran in 1027 ms", two ways out — fix on the branch or absorb into debt. The inspection ran, not `inspection-failed` — the caller's home survived.
3. Fix on the branch `f9a92c1633`; merge retried — `already-merged` (the branch changes nothing in total), worktree removed. The rule's triggers restored: `submit_work` and `merge_worktree` before.
4. `merge_worktree` takes no `project` (`body-shape`), unlike its neighbouring doors; rootId suffices.

## Conclusion

- **Confirmed:** the merge gate with a linter program works from a thread of another home; the refusal with place, time and ways out.
- **Defect:** a new worktree of a project with a linter rule cannot be judged until the user installs dependencies themselves — handed to an agent as [[01a1615d-dd0f-7ca3-b5a9-9b24cf1550e8|worktree-deps]].
- **Defect:** every switch of a thread between main and a worktree of one project resends the whole law and refuses the act — [[65bc9a93]], handed to [[01a1615d-9c1c-7791-8f8d-99ec8119fe6f|law-redelivery]].
