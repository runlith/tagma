---
id: 01a13d48-9aa9-71d0-a2d8-68fe8e55c839
title: "Tooltip: one host per app, `Tooltip` registers its trigger and holds no instance of its own"
ord: 3
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/shared/ui/tooltip
  - kind: file
    ref: apps/tagma/app/src/lib/shared/ui/tooltip/Tooltip.svelte
  - kind: file
    ref: packages/primitives/src/tooltip.svelte.ts
---
Only one tooltip is visible at a time, so it has one host. Before the migration, each of the 186 tooltip calls in 90 files created its own bits `Tooltip.Provider`, `Root`, `Trigger`, and a scroll listener on window. List rows paid for that on every row.

**Layout and names.**
- Kit: `@runlith/primitives/tooltip.svelte` — the "current tooltip" state (anchor, text, side) and the trigger attachment: a `tooltip` instance, `tooltip.trigger(() => TooltipOptions)`.
- The app `Tooltip` component lives in `shared/ui/tooltip/Tooltip.svelte`. It replaces `shared/Hint.svelte`; every `<Hint>` call becomes `<Tooltip>`, and consumers import this file directly.
- The `TooltipHost` host lives in the same `shared/ui/tooltip/` folder.
- The bits wrappers in this folder (`index.ts`, `tooltip*.svelte`) are deleted. No barrel. Neither `Hint.svelte` nor `Tooltip.svelte` remains in `shared/`.

**Behaviour.**
- **Cost.** A `Tooltip` instance costs O(1): handlers hang only on its own element. Global listeners — `pointerdown`, `keydown`, scroll, `blur` — exist only while the tooltip is visible.
- **Opening.**
  - Pointer hover with a `delayMs` delay, 700 ms by default.
  - Keyboard focus via `focusin` and `:focus-visible`. This is new behaviour: bits hung `onfocus` on a span with `display: contents`, and `focus` does not bubble, so focus on a button inside a tooltip never opened it.
  - A tooltip does not appear on touch.
  - A tooltip does not appear while a layer opened from its own trigger is open: a tooltip on a menu button never stands above the menu.
- **Closing:** pointer leave, `pointerdown`, `keydown`, scrolling of the trigger's ancestor, `blur`. Scrolling elsewhere does not close the tooltip: the thread feed scrolls programmatically on every answer chunk.
- **Tooltip** does not intercept the pointer (`pointer-events: none`).
- **Host.** One app component mounts next to the dialog hosts in `app/Root.svelte`. Placement and depth are [[313c7343]]. On the `/_desktop/view/*` and dictation routes there are no hosts, and no tooltips there either — same as dialogs.
- **Anchor.** The virtual anchor over a text range for a `display: contents` wrapper stays the anchor function from [[313c7343]] and returns an element for the `isConnected` check.
- **API.** `Tooltip` keeps `text`, `side`, `delayMs`, `class`, `style`. `hoverable` is deleted: it has no consumers. There is no zero-delay window between adjacent tooltips — [[0387657d]].

**Performer check** (unit):
- one visible tooltip when moving between triggers;
- delay;
- closing on `pointerdown` and `keydown`;
- scrolling a foreign container does not close the tooltip, while scrolling the trigger's ancestor does;
- no tooltip appears while its own trigger's layer is open;
- keyboard focus opens the tooltip.
