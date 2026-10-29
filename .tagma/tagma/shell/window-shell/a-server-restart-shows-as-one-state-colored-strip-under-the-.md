---
id: 01a15540-83bd-7072-9831-ee4b6a2d36fd
title: A server restart shows as one state-colored strip under the top bar instead of a card, toast and graph banner
ord: 8
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15089-14c2-7aa1-9eee-2df7929f6822",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a12699-1673-714b-a6a5-79ebd801f443
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/RestartNotice.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/wire/Restart.svelte.ts
---
The operator's decision is option C from the `http://localhost:5634/a/f191877e3926` page. The strip stands in `Shell.svelte` under `TopBar`, full width, and shifts the window, overlapping nothing: yellow while an announced restart runs (`i of n` step with progress, the announced heavy refresh in one line), neutral while the server is silent with no announcement, green "Tagma is back", red "Tagma did not start" with Details, calm "Tagma did not restart" with a cross when the server stayed the same. Inner phases, migration names and the `migrationLoadText` dump don't reach the screen. The "Live connection lost" toast goes away: a drop is no person's act. `Recovery` stops taking a connection drop as its own failure, like the other subscription owners. A socket failure with no details is described with no "browser" word.

Start: `apps/tagma/app/src/lib/app/chrome/RestartNotice.svelte`, `wire/Restart.svelte.ts`, `chrome/Shell.svelte`, `features/graph/Recovery.svelte.ts`, `wire/liveFailure.ts`. Proof: typecheck, `Restart` tests and the shell.
