---
id: 01a18979-b879-736b-8656-f77632188b01
title: A submenu opens at once on hover and yields to another row unless the pointer is heading into it
ord: 31
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/shared/ui/dropdown-menu/dropdown-menu-sub-content.svelte
  - kind: file
    ref: packages/primitives/src/menu.svelte.ts
---
Hovering a submenu trigger opens its submenu at once, and the submenu appears without an enter or exit animation, so moving between two triggers swaps their submenus in the same frame.

When the pointer leaves an open submenu's trigger, its menu protects the submenu only if the pointer's last move before leaving brought it closer to the submenu's near edge. A pointer leaving straight up or down, or away, hands over to the row under it in that same event. While protected, the menu's rows ignore the pointer.

The protection lasts while the pointer stays inside the triangle from the leave point to the submenu's near edge and keeps getting closer to that edge. The edge is read from the submenu's current box, which grows and shrinks while open. Only a move that brings the pointer closer than ever before extends the protection. Jitter, vertical moves and slowing down never extend it.

The protection ends in one of five ways:
- the pointer enters the submenu;
- the pointer leaves the triangle, and the row under the pointer takes it in that same event;
- a few frames pass without the pointer getting closer, and the enabled row under it is highlighted and its own submenu opens without another move;
- the submenu closes by any means, such as Escape, ArrowLeft, the keyboard moving the highlight, or unmount;
- a touch pointer moves.

Space that is no row — gaps, separators, labels, anything outside the menu — never closes the submenu. Only another row, the keyboard or closing the menu does.

Radix, Floating UI and React Aria hold to the same principle: protection requires movement toward the submenu, not just movement.

Five designs were rejected:
- **A rest timer restarted by every pointer event.** A hand on a row never stops producing small moves, so the row under it waited until the hand froze completely. This was measured at 310 ms in the production build.
- **The heading of each stretch of a few pixels, judged against a cone to a tall submenu.** It waited for the first stretch before deciding, and for a submenu as tall as the window the cone is almost a half-plane, so nearly any upward move counted as heading.
- **The sign of each step's horizontal movement.** It closed the submenu on any single step that did not advance toward it, such as jitter or a vertical step.
- **Containment in a triangle from an apex set back behind the leave point.** A timer was refreshed on every move, and the release only cleared the highlight. With a submenu taller than its menu and shifted up, an almost vertical move to the row above counted as heading into the submenu: that row was held while the pointer moved, opened only after a pause, or never opened until the pointer moved again.
- **An enter transition on submenus.** It delayed the new submenu while the old one faded out over it.
