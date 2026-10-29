---
id: 01a14b89-0cf9-7d5a-8074-a1cf7b10d689
title: "A layer's first placement at its anchor lands in the DOM after attach: the popover focus and the enter transition await it"
ord: 17
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a13d48-9aa9-71d0-a2d8-68ff1bd06392
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/shared/ui/emerge.ts
  - kind: file
    ref: packages/primitives/src/menu.svelte.ts
  - kind: file
    ref: packages/primitives/src/popover.svelte.ts
---
Until first placement `Float` holds the layer in `visibility:hidden`, and placement is computed in the effect `float.floating` creates only after the element is attached.

**Focus.** Chromium does not focus an invisible element. So the focus effect in `popover.content` awaits `float.placement` and is created before the placement effect: then it restarts on the placement write, and `$effect` restarts after Svelte applied the new line style to the DOM. Created after, it would have seen the placement written in the same effect batch before the style update, and focus would not have stood. jsdom focuses even the invisible, so a unit test does not check that order.

The effect lives in the surface attachment, not in the state constructor: `Portal` mounts content as a separate Svelte root, and the app-root effect could run before the portal root applied the style. That left a terminal menu opened from the engine without focus, the keyboard staying in xterm. Menus and selects hold the same order.

The focus-return effect checks against the `Popover` opening count, not the openness flag: while the outro runs, Svelte suspends effects of the leaving branch, and an opening before the outro ends resumes the same attachment — the effect would never have seen the closing and would never return focus a second time.

**Entering.** The `emerge` transition returns a function, not a config: Svelte calls it as a microtask later, when the final side after the flip is already known. Read at once, the side at the first opening is not yet computed, and the layer would ride in from below whatever the side.
