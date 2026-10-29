---
id: 01a14c05-9e8f-7c75-a633-b2aaba2d4d54
title: The status bar holds the environment's state and entries to its readings next to the current work
ord: 8
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2a2b526a4f0
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2a3d7370c0e
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2af0ada7311
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/liveTrouble.ts
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/LoadButton.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/RestartNotice.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/Standing.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/StatusBar.svelte
  - kind: file
    ref: apps/tagma/server/src/settings/contract/wire/appearance.ts
---
**Value.** The operator sees the environment's state without leaving the working page: link, working installation, checkout, errors, load and quotas — and opens the terminal panel right above it.

**How.** The desktop shell's standing status bar and its owners' unfolding elements; `appearance.loadInStatusBar` governs the load button. At the left end, on a project page — the terminal-panel button: the place's icon and running-terminal count, pressed while the panel is open, the tooltip names its chord.

**Behaviour.** Segments assemble their areas' ready projections. Link and server show as one "Tagma" mark: first the link — connect, loss, background pause, refusal to a device — then server and installation; normally it carries the build hash and `↓N`, how many commits or releases to the update. Link goes first because server state does not refresh without it. The installation state keeps its last reading and shows when it is stale; a long restart gets a separate message above the page. Hiding load removes its button but does not switch off the readings threads need or the ability to open load from their icons.

**Limits.** The status bar joins access to readings but does not recount load, quotas or installation state. Updating, restarting, keeping the machine awake and checkout actions stay their areas' features.
