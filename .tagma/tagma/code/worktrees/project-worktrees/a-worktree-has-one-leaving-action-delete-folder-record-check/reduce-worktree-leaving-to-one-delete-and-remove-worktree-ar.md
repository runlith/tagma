---
id: 01a13620-124c-75b1-8c9b-9ccc2dbd69ab
title: Reduce worktree leaving to one 'Delete' and remove worktree archiving from server, app, and store
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13620-38ed-786c-8629-dfdc6e7a44e0",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1361f-e541-797c-b68e-d735674c0c58
---
Implement [[674c0c58|the single worktree "Delete" action]] in full: `delete_worktree` does everything the spec describes. `archive_worktree`, `restore_worktree`, `forget_worktree`, and `list_archived_worktrees` leave. `clean_up_worktrees` and the "after merge" variant delete. The migration removes stored archival records. In the app the worktree keeps one button with no confirmation; the archived section leaves.

Start at `apps/tagma/server/src/worktrees/retirement/`, `worktrees/contract/wire/operations/retirement.ts`, `landing/merge/integrate.ts` (the after variant) and `apps/tagma/app/src/lib/features/worktrees/` (`FinishItems.svelte`, `Finishing.svelte.ts`, `FinishDialog.svelte`, `CleanupDialog.svelte`).

Done when the spec's "Proof" is met and the work has landed.
