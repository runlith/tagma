---
id: 01a15f67-1630-7996-8ed7-0124191a770c
title: "No tooltip over a disabled button: the `display: contents` wrapper receives no hover"
ord: 3
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a15f40-652a-7997-8052-f70678cac4f5
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/shared/ui/button/button.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/shared/ui/tooltip/Tooltip.svelte
---
`Tooltip` without `class` wraps the trigger in `display: contents`, while `Button` puts `disabled:pointer-events-none` on a disabled button (`shared/ui/button/button.svelte`). The wrapper has no box of its own, the button receives no events and has no keyboard focus either, so the tooltip over a disabled button never opens. This currently hides the hints on the disabled send button (`native/ChatButton.svelte`: "Type a message to send"), on Back/Forward with no history, and elsewhere. This predates the move of keys to badges. In `CommitBox` the case is covered by a `class="flex flex-1"` wrapper, but the general mechanism stays broken.

Fix in one place: either the disabled button stays visible to the pointer (no `pointer-events-none`, hover styles only under `enabled:`), or `Tooltip` itself gives a disabled trigger a wrapper with a box, without changing consumers' layout. Before choosing, verify in a real browser whether disabled `<button>` elements receive `pointerover` events in Chromium/Electron.
