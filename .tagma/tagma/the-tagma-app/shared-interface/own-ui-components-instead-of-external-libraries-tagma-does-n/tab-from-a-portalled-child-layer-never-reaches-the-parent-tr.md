---
id: 01a14b91-efae-7714-9ba4-3089812b4267
title: "Tab from a portalled child layer never reaches the parent trap: move the \"who holds Tab\" decision into the stack"
ord: 24
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14b1b-14eb-75f6-a49c-490e3ea419ee
  - kind: relates
    to: 01a13d48-9aa9-71d0-a2d8-68fc313c7343
sources:
  - kind: file
    ref: packages/primitives/src/dialog/content.svelte
  - kind: file
    ref: packages/primitives/src/OverlayLayers.svelte.ts
  - kind: file
    ref: packages/primitives/src/popover.svelte.ts
---
The popover trap listens for `keydown` on its own surface, the dialog trap on `document`, but only as the top modal layer. A child layer's surface is portalled into a separate place in the overlay root, and its `keydown` never bubbles up to the parent surface. So a child layer without its own trap (a popover with `trapFocus={false}`, kit menus and selects, unless they take Tab) releases Tab in DOM order beyond the logical subtree, and the stack then closes the parent on focus loss. Listening on `document` from every component is no way out: listeners run in registration order, and the earlier-opened parent would intercept Tab from a trapping child, as would the dialog from a popover inside it.

No consumer path meets this today: bits selects and menus inside popovers take Tab themselves (`preventDefault`). The kit menu and select tasks will meet it.

**To do.** The "who holds Tab" decision belongs to the stack, like Escape. A layer declares trapping in `LayerConduct`; one Tab listener on `document` (bubble, skipping a consumed `defaultPrevented`) finds the innermost trapping layer in the target's logical chain — without a target in layers, the top modal — and runs `cycleTab` over its surfaces and descendant surfaces. The `dialog/content.svelte` and `Popover.content` traps move onto it. The body of the [[313c7343|stack spec]] on Tab trapping is edited in the same change.

**Proof** (unit): Tab from the last element of a non-trapping child layer returns to the parent cycle; a trapping child holds its own cycle; a popover inside a dialog holds its own; the dialog Tab tests from `OverlayLayers.test.ts` and `dialog/` are green.
