---
id: 01a1325b-2101-7bc3-a607-8b9c9129dec4
title: A file created by a restart-interrupted command lands in neither the lines nor its thread's unowned paths
ord: 6
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a13236-64ca-761e-999f-75e717872cd0
sources:
  - kind: symbol
    ref: apps/tagma/server/src/change-record/record/recovery.ts
    symbol: recoverCommands
---
If the server fell while a command ran, its open window is judged at startup (`recoverCommands`, `record/recovery.ts`): only a path from the window base's keys (`Object.keys(base)` — paths dirty at the measurement time) whose digest on disk differs from the recorded one and is explained by no record line counts as shifted. A file the command created (never in the base) misses this pass: it gets neither lines nor the thread window's `command_unattributed` with the `restart` reason, the thread's `read_changes` and paths never name it, `submit_work` never sees it, and it stands dirty until the next command touches it.

Found by review `71543d4b49` (the attribution lens, thread 01a1323d-2482-7341-b6e9-0a12c8844ad3); this change never touched `recovery.ts` code.

Where to start: a window caught open should also judge paths missing from the base — e.g. the checkout's `git status` at startup against the window base (new untracked and staged paths with mtime inside the window's life), with the same `restart` reason for the window's thread.

Done when an itest with a restart mid-command that created a file shows that file in the window thread's unowned paths and landing it through `paths`.
