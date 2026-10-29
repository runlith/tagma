---
id: 01a0c71d-d464-74ee-bb47-1bd874e37e74
title: Make the minimal example conceal through the host instead of `window.hide()`
ord: 11
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0c702-47e3-7172-8dbb-6b3db48b9d05
sources:
  - kind: file
    ref: packages/window-behavior/examples/electron-minimal/main.mjs
---
`examples/electron-minimal/main.mjs` answers `example:minimal:hide-window` with `window.hide()`, so the host's intent still says shown and `isShown()` lies after the hide — the rule this task was discovered from is broken inside its own module. Replace the call with `host?.conceal()` and confirm the e2e spec that reveals after a hide still passes.