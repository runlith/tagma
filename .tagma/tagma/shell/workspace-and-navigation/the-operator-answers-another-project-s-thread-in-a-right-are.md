---
id: 01a14c05-9e8f-7c75-a633-b2a8e654f21a
title: The operator answers another project's thread in a right-area tab of the current project
ord: 6
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a13de0-db67-7af3-8e3c-e8c9ee9a665a
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-694b05354451
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2a559161fe2
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2a70614903d
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/panes/paneSlot.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/app/panes/SidePane.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/shell/DesktopShell.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/TagCatalog.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/BlockCard.svelte
---
**Value.** The operator answers another project's thread while staying in the current project and keeping its main screen.

**How.** `ShellOps.openThread` with a beside target opens the thread as a right-area tab; the tab carries the thread home's project mark and offers to open it main.

**Behaviour.** The tab holds the home project, creates a slot under it, and routes reading and sending through its session. The home persists in the layout and when moving inside the tab. The main move leads home; actions needing its checkout or terminal may also carry the window there.

**Limits.** An active foreign-home tab holds its project services and subscriptions, the home's vocabulary among them.
