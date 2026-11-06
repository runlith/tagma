---
id: 01a1705d-f50f-7de3-835c-49ab9735af57
title: "A shortcut from a desktop window's child frame is forwarded to the page before the menu: any published chord with Cmd, Ctrl or Alt from a frame Tagma serves, and from any other frame only the chords declared for its address"
ord: 27
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/keys/Keymap.svelte.ts
  - kind: file
    ref: apps/tagma/desktop/src/interception.ts
---
A shortcut pressed inside a child frame never reaches the app document's `keydown`: the frame has its own document. Without interception it goes to Electron's menu, and e.g. the View menu's `zoomIn` role zooms the whole Tagma window. So the desktop catches such shortcuts in the window's `before-input-event` while focus is in a child frame and hands them to the page over the `keys` bridge as a press carrying the frame's address.

Two kinds of frame are told apart by the window's publication (`WindowKeys`):
- **A frame Tagma serves** — a plugin view on its plugin's origin; its origin is in `served`. Any published chord that carries Cmd, Ctrl or Alt is forwarded, so ⌘K opens Find or ask from inside a plugin section. Bare keys and Shift-only keys stay with the frame.
- **Any other frame** (a published page, an MCP App) keeps every key except the chords a binding declared in `framed` for an address that starts the frame's address.

Interception is decided by the focused frame's address (`focusedFrame.url`), not by tracking area focus in the app. The app document never sees focus moves between frames — neither `pointerdown` nor `focusin` from a frame reaches it, and moving from one remote frame to another never even blurs the window — so the app cannot know which frame holds focus, while the desktop knows.

The event is cancelled before the frame's renderer, so forwarding more than this would take typing and the page's own shortcuts away from a frame. Built-in browser pages forward every published chord the same way, with `page` set.