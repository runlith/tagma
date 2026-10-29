---
id: 01a16637-60ed-76a9-b850-9818aa7abca9
title: "App rounding is three steps by role: 0 for state marks, 6 px for tiles, buttons and rows, 10 px for surfaces"
ord: 80
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a165f0-b92e-7022-bbac-5ddefb22bd2d
  - kind: relates
    to: 01a1661f-b314-7930-87f2-794af671eb5f
sources:
  - kind: file
    ref: packages/chat-ui/src/composerFrame.ts
  - kind: file
    ref: packages/chat-ui/src/ComposerMenuPopup.svelte
---
State marks are square, because a square means "state" ([[18dd9e6b]]). Tiles, buttons and rows are rounded 6 px (`rounded-md`), surfaces — menus, popups, cards, the composer and the operator message — 10 px (`rounded-lg`). There is no larger rounding left: the composer's 18 px was the only one in the window, and the operator reduced it to the surface step.

A row inside a surface with a 4 px inset (`p-1`) rounds 6 px, because 10 − 4 = 6: the inner corner runs parallel to the outer one. With an 18 px frame and the same 6 px row, the selected row stood in the frame's arc with someone else's corner. A new surface with an inset keeps the same equality "outer radius minus inset".
