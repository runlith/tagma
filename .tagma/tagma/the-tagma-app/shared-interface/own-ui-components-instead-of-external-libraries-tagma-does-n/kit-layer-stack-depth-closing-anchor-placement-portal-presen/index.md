---
id: 01a13d48-9aa9-71d0-a2d8-68fc313c7343
title: "Kit layer stack: depth, closing, anchor placement, portal, presence, focus, and scroll-lock for dialogs and all popups"
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: packages/primitives/src/dialog
  - kind: file
    ref: apps/tagma/app/src/lib/shared/ui/foreign-layer.svelte.ts
  - kind: file
    ref: packages/primitives/src/dismissal.ts
  - kind: file
    ref: packages/primitives/src/float.svelte.ts
  - kind: file
    ref: packages/primitives/src/focus.ts
  - kind: file
    ref: packages/primitives/src/layer.svelte.ts
  - kind: file
    ref: packages/primitives/src/layers.ts
  - kind: file
    ref: packages/primitives/src/OverlayLayers.svelte.ts
  - kind: file
    ref: packages/primitives/src/place.ts
  - kind: file
    ref: packages/primitives/src/tracking.ts
---
Foundation: built first, and the dialog moves onto it in the same change.

**One open-layer stack — one fact and one owner.** `OverlayLayers` becomes the open-layer stack. It holds dialogs (from the host and inline), menus, submenus, popovers, selects, and tooltips.
- One stack per document: the kit holds its `overlayLayers` instance, not an app-graph service. Escape, the outside pointer, and the z band belong to the document; two stacks in one document would fight over one press. So a layer also works in a component test without the app graph.
- A layer registers on open.
- On close, a layer leaves closing at the closing moment, and holds its z while at least one of its surfaces still stands on the page, i.e. until the outro ends.
- A layer has a parent — the layer inside which it was opened. The parent is read from Svelte context. The kit portal mounts children with `getAllContexts`, so context passes through. Closing a parent asks open descendants to close too. Host dialogs are neighbours in the stack without a parent: their show nesting is led by the overlay queue (`within`), and closing a show closes its steps there.
- **Closing is a request.** The stack decides whom to ask (Escape, outside press, focus outside, anchor gone, parent closed) and calls the layer owner's `onDismiss(reason)`. The owner closes itself or refuses. The stack holds no component state and knows none of its props: refusal is the `ignore` policy on Escape and `dismissOnFocusOutside={false}`.

**Depth.**
- `layers.ts` keeps two steps: the stack band and above it the notifications step, on which `NoticeCards` and `RestartNotice` stand.
- Removed:
  - the `ambient`, `floating`, `frame`, `panel`, `bottomBar`, `launcher`, `popover`, `progress`, `wall`, `support`, `snackBar`, `toast` steps;
  - `steps` and `depthUtilities` (no `z-<step>` utility exists in code);
  - the `panel` band in `OverlayLayers` (lives only in tests);
  - `popover-layer.svelte.ts`, `OverlayLayers.popoverAbove`/`popoverBackdropAbove`.
- Inside the stack band, z follows opening order: later-opened stands higher. A layer receives z as an inline style from the stack. There are 99 slots in the band. When they run out, the stack renumbers occupied slots from the bottom keeping the same order, and later-opened still stands higher. No `z-*` classes on layer content; today there is `z-50` in wrappers and `z-[120]` in `features/providers/ModelField.svelte:63`.
- An inline dialog applies its z the same way as a host dialog.
- The top layer (Popover API, `<dialog>`) is not used. Otherwise dialogs, notifications, and the restart banner would all have to move there, and jsdom doesn't have it.

**Closing.** One listener — the stack.
- **Escape.**
  - A `keydown` listener on document in the bubble phase. It skips `isComposing`.
  - An Escape consumed by an element inside the layer (`preventDefault` or `stopPropagation`; the name field in `app/chrome/WorktreeSwitcher.svelte:249-252` does this) leaves the layer open. bits closed the layer even on `defaultPrevented`; this change is deliberate.
  - Otherwise Escape goes to the top layer. Under the `close` policy the layer closes, and the stack synchronously calls `preventDefault` so window handlers (`threads/ColumnState.svelte.ts:242`) see that Escape is taken.
  - The `ignore` policy means "Escape is taken": `preventDefault` without closing, and it goes no lower. This is an owner that refused to close on Escape. A dialog that refused Escape calls `onEscapeIgnored` — a host `apply` option and a root prop: that is how the agent library asks about an unsaved draft wherever focus stands in it, and only once Escape has reached it rather than an open select or menu inside it.
  - Roles on elements are preserved: the window-capture `FilesColumn` handler and `checkout/DiffTab.svelte:159` decide by them.
- **Outside pointer.**
  - The decision is taken in the capture phase on document, before the target's handlers. Those of the currently open layers close top-down whose logical subtree does not contain the target: the layer itself, its trigger, and its descendants, wherever they stand in the DOM.
  - Closing stops at the layer containing the target and at a modal dialog: its scrim decides for itself.
  - A layer opened by this same press does not see the decision.
  - A press on an open layer's own trigger closes it rather than reopening it.
  - Outside means a press of any button: a right-click elsewhere closes an open menu, and `contextmenu` opens a new one.
  - On touch, a layer closes on tap (`click` after `pointerdown`), not on `pointerdown`, so a scroll gesture closes nothing. A scroll gesture's `pointercancel` drops the pending tap.
- **Focus outside.**
  - A non-modal layer closes when focus leaves its logical subtree. The pass runs top-down the same way as the pointer one, and stops at the layer holding the new focus and at a modal dialog.
  - So a layer opened above that took focus does not close the ones below: a menu with the ⌘K palette opened above it stays under it, Escape removes the palette first, and its closing returns focus to the menu item it was opened from.
  - Window `blur` closes a layer only when `document.activeElement` is an iframe outside the subtree: focus moved into a plugin view. Cmd+Tab into another app closes nothing.
  - Refusal is the `dismissOnFocusOutside={false}` prop; the terminal menu holds it. A menu opened from the engine takes the keyboard like any menu: arrows, Enter, and Escape work, and the engine receives focus back once the menu has closed.
  - Focus returned by the stack itself when closing another layer does not count as leaving: closing a top menu does not close a neighbouring one.
- **Tooltip** stands in the stack by depth but takes no part in closing — see [[8e55c839]].
- **Removed from the dialog** are the heuristics (`dialog/content.svelte:39-48, 85-103, 157-186`) and the `defer-otherwise-*` policies from `types.ts`: the app passes only `close` and `ignore`.

**Placement.** A pure function `place(anchor: Rect, floating: Size, viewport: Size, options) → Placement`. An own function instead of `@floating-ui/dom`: the geometry of one layer is a small calculation, and an own function is tested as a function.
- Options: `side`, `align`, `sideOffset`, `alignOffset`, `collisionPadding` — a number or a per-side object (`providers/usage/Popover.svelte:101`, `providers/Menu.svelte:142`).
- When the layer does not fit on its own side but there is more room on the opposite one, it flips. Along its side it shifts inside the viewport.
- The result is the final side and alignment, the available width and height on the final side, and the origin for animation.
- The `anchor` comes in three kinds:
  - an element;
  - a `{ x, y }` point — a context menu at the cursor, instead of a 1px stand-in div (`ContextMenu.svelte:42-52`);
  - a function returning a rectangle plus an element for the `isConnected` check — a `Tooltip` over a text range (`shared/ui/tooltip/Tooltip.svelte`).

**Tracking.** One driver for the whole stack, running only while at least one layer is open or a notifications surface is visible. It listens to events rather than polling by frames: cost grows with changes, not with time (rule 2393aff1). Each firing recomputes placement at once. The stack takes rectangles for the projection once in the nearest frame after a change, once Svelte has applied the new placement, and bits its own.
- Sources: scroll in capture on document, window resize, `ResizeObserver` on the anchor element and the layer, `IntersectionObserver` on the anchor — a shift without scrolling, when a live list rebuilds.
- On every firing, `isConnected` is checked. When the anchor has left the DOM, the layer closes and the tooltip hides.
- `ResizeObserver` and `IntersectionObserver` are stubbed in `@runlith/testing/jsdom-setup`. Today `ResizeObserver` is stubbed piecemeal (`ThreadPanes.svelte.test.ts:183`).

**What a layer receives on its element:** `data-side`, `data-align`, and the `--float-anchor-width`, `--float-available-width`, `--float-available-height`, `--float-origin` variables. The component paints position, z, and variables with one placement style string, not by writing to `element.style`: a code write would be overwritten by the next Svelte `style` attribute update. The layer size is taken from `offsetWidth`/`offsetHeight`, without the entrance animation's transform. They replace every `--bits-*` on consumers: `--bits-floating-available-height` in six files, `--bits-popover-content-available-height` in `WorktreeSwitcher.svelte:228`, and anchor widths in wrappers.

**What the stack hands out.** The embedded browser's native page view lies above all HTML in the window, and the [[255c4582|desktop host]] freezes it under layers. For that, the stack hands out three things in its own contract; the host is the consumer, the kit knows nothing about it.
- Rectangles of open layers — a reactive stack projection updated by the same tracking driver. This is one `overlayLayers.rects` list: surfaces of open layers and visible notification surfaces; all the host needs is what lies above the page.
- Rectangles of the notifications step surfaces. `NoticeCards` and `RestartNotice` register in the stack with a kit attachment; the stack reports their rectangles while visible, and they take no part in closing.
- The intent-to-open-layer signal — before the layer is rendered (`overlayLayers.onIntent`).
  - The kit trigger (`layer.trigger`) raises it on `pointerdown` and on Enter, Space, ArrowDown, ArrowUp. A component with a different open key (ArrowRight on submenus, the ContextMenu key) calls `layer.prime('keyboard')` itself.
  - The kit overlays door (`Overlay.open`) raises it on every dialog opening, before its chunk loads. So ⌘K and commands raise intent with no code at call sites.
  - A modal layer opened without its own trigger (an inline dialog on a flag) raises it at opening time.

**Portal.** A layer renders into the overlay root (`dialog/overlay-root.ts`). The dialog portal becomes the shared kit portal.

**Electron.** A layer overlapping the topbar (`app/chrome/TopBar.svelte:72` — `drag-region`) does not lose clicks. One rule in `app.css` sets `-webkit-app-region: no-drag` on layer and notification surfaces by the `data-overlay-surface` attribute the kit gives them.

**Presence.** A closing layer lives until its outro ends. Svelte transitions are used, as on the dialog (`dialog/transition.ts`). The exit direction is taken from the final side after flipping: the layer placement gives it, and the component writes the transition itself.

**Focus.** `dialog/focus.ts` becomes the shared kit module.
- **Tab locking.** Who holds Tab is decided by the stack, like Escape. A layer declares locking in `LayerConduct.trapFocus`; a modal layer locks without it, a popover until `trapFocus={false}`, menus and selects do not lock. One listener on document in the bubble phase takes, top-down, the first layer that is modal or locking and stands in the focus logical chain (the active element's owner and its ancestors), and runs the cycle over its surfaces and descendant surfaces: a select inside a dialog is portalled outside its DOM but enters the cycle. Tab from a layer's last element moves to the first element of an open child layer, and from the cycle's last element to the start; so Tab from a non-locking child's last element returns to the parent cycle, while a locking child (a popover inside a dialog) holds its own. A Tab already taken (`defaultPrevented`) is not touched. Listeners in every component won't do: they run in registration order, and the earlier-opened parent would intercept Tab from a locking child, while a portalled child's keydown never bubbles to the parent surface. The palette switches groups on Tab in `onkeydowncapture` with `stopPropagation` (`CommandPalette.svelte:216-221`), and that Tab never reaches document.
- **Opening.** The opening means is read from the event that opened the layer: the component passes it to `layer.open(by)`, defaulting to the trigger's last press.
  - A menu opened by keyboard focuses the first item. A menu opened by pointer focuses the content with no item highlighted.
  - A popover on any opening means hands focus to the first field or first tabbable per `focusInitialIn` rules. So pickers accept typing immediately.
  - A select hands focus to the list with the selected item highlighted.
  - Explicit — the `initialFocus: false | (() => HTMLElement | null)` prop. It replaces `onOpenAutoFocus` on `threads/Peek.svelte:371`.
- **Returning on close.**
  - Focus returns at closing time, not at outro end: to the trigger; without a trigger to the anchor element; without either to the element focused at opening (a host dialog, the ⌘K palette). This happens only when focus is currently inside the closing layer or on `body`.
  - Closing a non-modal layer by an outside pointer does not return focus: the press already put it where pressed.
  - A descendant closed together with its parent does not return focus; the parent returns it when focus stood in it or in its descendants. A dialog closed by a scrim press returns focus: the scrim takes no focus, and without the return it would stay on `body`.
  - Focus that moved to another live place stays there: an item opened a dialog, a rename field appeared, the terminal engine took the keyboard.
  - Explicit — the `returnFocus: false | (() => HTMLElement)` prop. It replaces all 7 `onCloseAutoFocus`.

**Moving into the worktree.** While menus, popovers, selects, and tooltips stand on bits, their content registers in the stack as a layer that never closes on the stack's requests: bits leads closing. This is the app's `foreignLayer` (`shared/ui/foreign-layer.svelte.ts`). It gives them z from the stack band, a `no-drag` surface, and a place in the Escape queue, so Escape in a menu inside a dialog closes the menu rather than the dialog. So `popover-layer.svelte.ts` already leaves with this change. The bridge layer stays open while the bits surface's `data-state` is not `closed`: in the bits outro it no longer stands in the Escape queue. bits has its own Escape queue, and it cannot see a kit dialog above a bits menu: leaving a menu open and opening the palette on ⌘K means Escape would close the menu and possibly the palette too. That leaves with the menu migration. The last component migration deletes `foreignLayer`.

**Scroll-lock.** Only a modal dialog locks scrolling. A kit dialog is always modal: the `modal` and `lockScroll` props are removed from `Dialog.Root`, and they have no consumers. Anchor layers follow scrolling rather than locking it. `lockPageScroll` (zero consumers) and `ScrollLockKind` are removed. Rule 8bd1c05a loses its subject and is removed in the same change.

**Performer check** (unit, jsdom):
- Escape closes only the top layer. A window handler sees `defaultPrevented`. Escape during `isComposing` or consumed by an element inside the layer does not close the layer. The `ignore` policy lets no Escape through below.
- `pointerdown` inside a submenu rendered elsewhere in the DOM does not close the parent menu.
- A press past a menu inside a dialog closes the menu but not the dialog.
- A press on its own trigger closes the layer. A press on trigger B with A open closes A and opens B.
- Touch closes on `click`, not on `pointerdown`.
- A layer opened from a dialog has higher z than the dialog; a notification is above both.
- `place`: flipping, shifting, available height, `align` start/center/end, a point as anchor, per-side `collisionPadding`.
- Tracking: a `ResizeObserver`/scroll firing recomputes placement; an anchor outside the DOM closes the layer.
- Focus returns to the trigger when it was in the layer. Focus that moved elsewhere is not touched. After closing by an outside pointer, focus does not return.
- Tab in a modal dialog passes into a select opened from it.
- The rectangle projection contains the open layer and the visible notification surface and loses them after closing; `pointerdown` on a trigger raises intent before opening.
- The existing `dialog/escape.test.ts` and `focus.test.ts` (moved with the focus module from `dialog/`) pass on the stack.
