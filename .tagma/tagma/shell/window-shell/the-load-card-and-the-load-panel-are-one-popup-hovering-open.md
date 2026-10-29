---
id: 01a15eb3-87f3-78d6-b8d7-9c3f48af481c
title: "The Load card and the Load panel are one popup: hovering opens the card, clicking expands it into the panel"
ord: 16
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/LoadButton.svelte
---
There is one window, so the card expands into the panel in the same place and layer, without a second popover over the first. It stays open while the panel is open (`View.open`) or hovering goes on; `mode` decides what to show, and it changes only while the window is open — otherwise on closing, the panel would briefly be replaced by the card as it disappears.

Expansion on click rests on handler order. The primitive popover click hangs on the button itself and fires first: it opens the closed window and pins the hovered one. The button's own Svelte `onclick` delegates to the root, so it sees the window already open and raises it to the panel. A click on the open panel closes it via the primitive, and `onclick` does nothing.

The panel, once shown, calls the popover's `hold()` itself, whichever way it opened: by click on the button, a line, or the card bottom, or via `View.reveal` from elsewhere over the hovered card. A window opened by hovering would otherwise close when the pointer leaves, and focus standing on the vanished card's button would fall out of the window.
