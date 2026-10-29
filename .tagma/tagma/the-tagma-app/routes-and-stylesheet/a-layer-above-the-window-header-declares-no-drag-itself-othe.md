---
id: 01a15a4a-13f0-7d50-a610-5c46dbee6f85
title: A layer above the window header declares `no-drag` itself, otherwise a press over a header gap drags the window
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/app.css
---
Electron decides whether a press drags the window from the `-webkit-app-region` rectangles of every document element, not from what is painted on top. The window header is declared `drag`, so a layer above it — a popup menu, popover, modal `<dialog>` in the top layer — with no `no-drag` of its own loses hover and clicks over the header's gaps: the press goes to window dragging. From outside it looks like a button that responds everywhere except part of its area — where the header gap, not its button, lies beneath.

So `no-drag` is declared by the layers themselves: overlay-stack surfaces via `[data-overlay-surface]` and any modal element via `:modal`. The top-layer layer's region is subtracted last, after the header — that is how Chromium walks the markup tree — and the subtraction works wherever the element sits in the DOM.
