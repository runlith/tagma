---
id: 01a14c05-9e8f-7c75-a633-b2a91727a3f5
title: The operator picks a light, dark or system window theme
ord: 7
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2a2b526a4f0
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/AppMenu.svelte
  - kind: file
    ref: apps/tagma/app/src/routes/+layout.svelte
---
**Value.** The operator picks a readable window appearance regardless of project, and may leave switching between light and dark themes to the system.

**How.** Theme in the app menu: System, Light or Dark.

**Behaviour.** The choice applies via `mode-watcher` and is stored browser-side. The theme bootstrap script applies before the app renders, and returning to System clears the explicit choice.

**Limits.** This is a device preference, not a server setting with project and user layers. Terminal content styling has its own owner and settings.
