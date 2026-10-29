---
id: 01a18979-b879-736b-8656-f77632188b01
title: "An open submenu yields only to another row of its menu: at once off the path toward it, after a rest on the path"
ord: 31
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/primitives/src/menu.svelte.ts
---
When the pointer leaves the trigger of an open submenu, its menu protects the submenu while the pointer moves inside the triangle from the leave point to the submenu's near edge. The edge is read from the submenu's current box at every move, because the submenu animates in, grows and shrinks while open. Inside that path the menu's rows ignore the pointer.

The protection ends in one of three ways:
- the pointer enters the submenu;
- the pointer steps off the path, and the row it lands on takes it in that same event;
- the pointer rests without moving, and the enabled row under it is highlighted and its own submenu opens, without waiting for another move.

Space that is no row — gaps, separators, labels, anything outside the menu — never closes the submenu. Only another row, the keyboard or closing the menu does. The rest must outlast the gaps between pointer events of a moving hand, and stay short enough that stopping on a row reads as immediate.

Two designs were rejected:
- Judging intent step by step closed the submenu on any single step that did not advance toward it, such as a jitter or a vertical step during a crossing to a far submenu.
- Containment alone, with a timer refreshed on every move and a release that only cleared the highlight, broke menus whose submenu is taller than the menu and shifted up to fit. The path then covered the rows above the trigger: moving to them was held for as long as the pointer moved, and after a stop nothing opened until the pointer moved again.
