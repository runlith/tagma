---
id: 01a13d48-9aa9-71d0-a2d8-690292e227b7
title: "Menu on the kit stack: one `onSelect`, checkboxes, radios, a submenu with an intent zone, a context menu at the cursor, and drag-select"
ord: 7
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/shared/ui/dropdown-menu
  - kind: file
    ref: packages/primitives/src/menu.svelte.ts
---
35 consumer files, 3 direct bits imports, `DropdownMenu.Sub` in 9 files. Context menus at the cursor: `checkout/files/TabStrip.svelte`, `checkout/files/TreeMenu.svelte`, `executions/terminal/ContextMenu.svelte`, `threads/Menu.svelte`.

**Parts:** `Root`, `Trigger`, `Content`, `Item`, `CheckboxItem`, `RadioGroup`/`RadioItem`, `Group`/`GroupHeading`/`Label`, `Separator`, `Sub`/`SubTrigger`/`SubContent`, `Shortcut` (look only).

**Mechanics.** Behaviour is the kit's `Menu` class (`packages/primitives/src/menu.svelte.ts`): `Menu.root`/`Menu.sub` register a stack layer, a collection in DOM-focus mode, and `Float`; `trigger`, `subTrigger`, `content`, `item` attachments. Look-bearing parts are `apps/tagma/app/src/lib/shared/ui/dropdown-menu/`; highlight is painted via `data-highlighted:`. `Content` props: placement, `anchor` (element or cursor point), `returnFocus={false}` instead of `onCloseAutoFocus`, `dismissOnFocusOutside={false}`. `unstyled` on `Item`, `RadioItem`, `SubTrigger`, and `Separator` hands the look to the consumer — that is how the usage menu and theme switches keep their own markup. `onSelect` receives the event that picked the item and runs before closing: consumers whose `open` setter erases the menu target (`TabStrip`, `TreeMenu`, terminal) read it in `onSelect`. An owner that refused to close the menu in its own setter (terminal gesture) leaves the layer in the stack: the stack closes only after `open`.

**Activation — one `onSelect` callback.**
- Today items carry 66 `onclick` in 25 files next to 42 `onSelect` in 7. This works because bits turns Enter and Space into `click()`.
- The kit synthesizes no clicks. The app's `Item` does not accept `onclick` in its type, so `bun check` finds every migration point.
- `WorktreeCard.svelte:61-62,129` closes the popover on a click on `[role=menuitem]`. After migration this `picked` becomes an `onDone` call from each item's `onSelect`.
- `closeOnSelect={false}` keeps the menu open. A pick closes the menu with all submenus.

**Trigger.**
- Attributes: `aria-haspopup="menu"`, `aria-expanded`.
- Mouse opens the menu on `pointerdown`.
- Touch opens with a tap.
- A pointerless click (`detail === 0`: keyboard or `element.click()` in tests) toggles the menu.
- Enter, Space, and ArrowDown open the menu with focus on the first item.

**Drag-select.**
- Press the primary button on the trigger, drag to an item, release — the item is picked.
- Releasing on the trigger itself picks nothing.
- A menu opened by right-click or programmatically picks only on an item press. Otherwise releasing the right button would pick the item under the cursor.

**Keys** — [[91d530fd]] in DOM-focus mode. Enter and Space pick; Space during typeahead continues the search. Escape closes one level. Tab closes the whole menu, and focus moves on from the trigger.

**Submenu.**
- Opens on hover, ArrowRight, or Enter; closes on ArrowLeft or Escape.
- While the pointer travels from `SubTrigger` to the open `SubContent` inside the triangle between them, neighbouring items do not steal the hover. A pointer that leaves the triangle immediately hands hover to the items under it; one that stops inside the triangle short of the submenu releases it after a short pause (300 ms without movement).
- Without this, the column of sub-triggers in the usage menu (`providers/usage/Popover.svelte:144-163`, `providers/Menu.svelte:132-233`) switches submenus on the diagonal.

**Context menu:** `anchor` is the cursor point; the terminal uses `dismissOnFocusOutside={false}`.

**Performer check** (unit):
- Enter and click pick and close; `closeOnSelect={false}` keeps the menu open;
- radios and checkboxes change value;
- ArrowDown on the trigger opens the menu with focus on the first item;
- typeahead and wraparound;
- ArrowRight and ArrowLeft for submenus; Escape in a submenu closes only it;
- a pointer path inside the triangle does not change the submenu;
- drag-select picks; right-click does not drag-pick;
- focus returns to the trigger;
- `checkout/CheckoutPage.svelte.test.ts` and `providers/Group.svelte.test.ts` are green.
