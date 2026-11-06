---
id: 01a1705d-f50f-7de3-835c-49ab9735af57
title: A shortcut from a desktop window's iframe is intercepted before the menu and handed to the app only if the binding declared that frame's address
ord: 27
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/keys/Keymap.svelte.ts
  - kind: file
    ref: apps/tagma/desktop/src/browser/framedKeys.ts
---
A shortcut pressed inside a window's iframe (a published page, plugin view, or MCP App) never reaches the app document's `keydown`: the frame has its own document. Without interception it goes to Electron's menu, and e.g. the View menu's `zoomIn` role zooms the whole Tagma window. So the desktop catches such shortcuts in the window's `before-input-event` while focus is in a child frame, and hands them to the app over the same channel as the built-in browser pages' shortcuts, with the frame's address; Keymap routes them only to bindings whose `framed` is the start of that address.

Interception is decided by the focused frame's address (`focusedFrame.url`), not by tracking area focus in the app. The app document never sees focus moves between frames — neither `pointerdown` nor `focusin` from a frame reaches it, and moving from one remote frame to another never even blurs the window — so the app cannot know which frame holds focus, while the desktop knows. A binding declares its frame's address (a page tab — its version's address), and a shortcut from another view's frame stays with that view and the menu.

Only a chord declared with `framed` is intercepted, not everything the app published: bare keys (transport Escape, space) are published too, as are shortcuts the views themselves need; the event is cancelled before the frame's renderer, so intercepting all would take typing and the page's own shortcuts away from it. A press in the app document is judged by the same binding itself — a page tab takes it only while it has focus in the right area.
