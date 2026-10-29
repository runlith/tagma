---
id: 01a18979-b879-736b-8656-f77632188b01
title: A submenu opens at once on hover and yields to another row unless the pointer is heading into it
ord: 31
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/primitives/src/menu.svelte.ts
---
Hovering a submenu trigger opens its submenu at once, and the submenu appears without an enter or exit animation, so moving between two triggers swaps their submenus in the same frame.

When the pointer leaves an open submenu's trigger, its menu protects the submenu only while the pointer heads into it. A heading is judged on each stretch of a few pixels: the stretch must point into the cone from where it started to the submenu's near edge. That edge is read from the submenu's current box, which grows and shrinks while open. Stretches shorter than that are jitter and decide nothing. While the pointer heads into the submenu, the menu's rows ignore it.

The protection ends in one of five ways:
- the pointer enters the submenu;
- a stretch points anywhere else, and the row under the pointer takes it in that same event;
- the pointer rests, and the enabled row under it is highlighted and its own submenu opens without another move;
- the submenu closes by any means, such as Escape, ArrowLeft, the keyboard moving the highlight, or unmount;
- a touch pointer moves.

Space that is no row — gaps, separators, labels, anything outside the menu — never closes the submenu. Only another row, the keyboard or closing the menu does. The rest is a few frames without pointer events: longer than the gap between events of a moving hand, short enough not to read as a delay.

Three designs were rejected:
- **The sign of each step's horizontal movement.** It closed the submenu on any single step that did not advance toward it, such as jitter or a vertical step.
- **Containment in a triangle from an apex set back behind the leave point.** A timer was refreshed on every move, and the release only cleared the highlight. With a submenu taller than its menu and shifted up, an almost vertical move to the row above counted as heading into the submenu: that row was held while the pointer moved, opened only after a pause, or never opened until the pointer moved again.
- **An enter transition on submenus.** It delayed the new submenu while the old one faded out over it.
