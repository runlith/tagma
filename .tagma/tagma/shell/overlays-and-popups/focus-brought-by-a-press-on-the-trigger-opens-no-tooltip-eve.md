---
id: 01a14b93-f364-7e37-97e7-fe3aa8b9d810
title: Focus brought by a press on the trigger opens no tooltip, even when the target matches :focus-visible
ord: 18
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a13d48-9aa9-71d0-a2d8-68fe8e55c839
sources:
  - kind: file
    ref: packages/primitives/src/tooltip.svelte.ts
---
Keyboard focus opens a tooltip at once, and the keyboard mark is `:focus-visible`. But a text field matches `:focus-visible` under any focus, and without the press flag a click or tap on the field inside a tooltip would open it instantly, while on touch there must be no tooltip.

So `pointerdown` on the trigger sets a flag, and the nearest `focusin` extinguishes it, opening nothing. Mouse pointer leave lifts the flag: a press that brought no focus must not swallow the next keyboard focus. Touch leave does not lift the flag: at a tap `pointerup` and `pointerout` arrive before the compatible `mousedown` that sets focus.
