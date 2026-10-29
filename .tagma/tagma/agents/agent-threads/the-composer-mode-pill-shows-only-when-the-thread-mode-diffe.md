---
id: 01a154f7-c3d9-71ac-8a58-fcfc2de30f21
title: The composer mode pill shows only when the thread mode differs from the project default
ord: 15
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15089-14c2-7aa1-9eee-2df7929f6822",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/mode.composer.svelte
  - kind: file
    ref: packages/chat-ui/src/ComposerMenuPopup.svelte
---
The composer mode pill is visible only when the thread mode differs from the project default. The default mode is what the project's `agent.approvalMode` gives. The mode pill appears when the thread (or draft) mode differs from it and leaves once it returns to the default; after returning it lingers while focus stays in the composer, so the next Shift+Tab does not click an empty spot. Shift+Tab and `/mode` always work. In the menu, the bottom line with the selected option's description stays only in the narrow composer, where the line itself hides the description.

Start: `apps/tagma/app/src/lib/features/threads/native/mode.composer.svelte`, `thread/authority.ts`, `packages/chat-ui/src/ComposerMenuPopup.svelte`. Proof: app typecheck, a check in the browser on your own instance.
