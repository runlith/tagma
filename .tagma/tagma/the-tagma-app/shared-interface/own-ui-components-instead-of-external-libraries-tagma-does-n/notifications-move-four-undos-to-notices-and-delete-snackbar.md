---
id: 01a14b1b-14eb-75f6-a49c-4908938272c2
title: "Notifications: move four Undos to `Notices` and delete `Snackbars`, the ark `Toaster`, and the snackbar/toast transports"
ord: 13
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13d48-9aa9-71d0-a2d8-690372053c34
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/notices/Service.svelte.ts
---
Build [[72053c34|notifications]] in the `own-ui` worktree. Start with `features/notices/Service.svelte.ts` (undo life 8 s, list scope) and the four `snackbars.open(UndoNotice…)` call sites, then delete Snackbars, SnackBarHost, toast, and transports from `packages/primitives`.

Done when: the spec's `Notices` unit tests pass, queue tests are rewritten and green, `rg` for removed names is empty, `bun check` is clean, commit via `submit_work`.
