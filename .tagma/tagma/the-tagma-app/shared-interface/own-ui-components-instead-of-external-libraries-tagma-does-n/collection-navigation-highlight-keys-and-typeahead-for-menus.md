---
id: 01a13d48-9aa9-71d0-a2d8-68fd91d530fd
title: "Collection navigation: highlight, keys, and typeahead for menus, selects, and command lists"
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/primitives/src/collection.svelte.ts
---
One kit mechanism backing menu ([[92e227b7]]), select ([[7e9ccf82]]), and the command list ([[44500eab]]).

- **Items** — elements attached to the collection via the `collection.item(() => ({ value, disabled, textValue, onSelect }))` attachment. Order is read from the DOM (`compareDocumentPosition`) at key-press time, so insertions, groups, and separators need no order registration. `disabled` items are skipped. Selection is the item's `onSelect(event)` with the event that picked it: Enter, Space outside a text field, or click; the kit synthesizes no clicks.
- **Field** — `collection.field`: the element holding focus. In DOM-focus mode it is the menu content itself (focus moves onto it when the highlight is removed); in `aria-activedescendant` mode it is the list's input field or the select's listbox; a mouse press on an item does not pull focus out of the field.
- **Highlight** — one value. The highlighted element gets `data-highlighted`. Two modes:
  - DOM focus on the item — menus, with the `menuitem`, `menuitemcheckbox`, `menuitemradio` roles;
  - focus in the field with `aria-activedescendant` and `aria-selected` — select and command, with the `listbox`/`option` roles. The collection sets the items' `aria-selected` and `id`; the component does not render them. `aria-selected` stands on the highlighted item, or — when the component hands its own value to the collection (`selected` in conduct — select, where the value changes only on selection, not on arrows) — on the item with that value.
- **Highlight value** — `collection.highlighted` (element) and `collection.value` (its `value`) are reactive; the component sets the highlight itself via `highlight(find(value))` or `highlight(first())`: menus — the first item on keyboard open, select — the selected item, command list — its own `value`.
- **Whose keys.** The collection handles keys only when the event target is its own field or item. It does not touch events from other elements inside the layer. For example, buttons and the name field in `app/chrome/WorktreeSwitcher.svelte:148,241,249-252` and `WorktreeCard.svelte:65,72,112,125` swallow Enter and arrows, and the collection does not intercept them.
- **Keys:** ArrowDown/ArrowUp, Home/End. The highlighted item scrolls into view. Menus and submenus wrap around; select and command lists do not: as with bits today (`loop = true` on menus, `false` on select and command).
- **Typeahead.**
  - Typed letters accumulate in a buffer that resets after a pause.
  - Repeating one letter steps through items starting with it.
  - Comparison runs against the item's `textValue`, or its text without one.
  - Letters are not intercepted from a text field: they are typed into the field.
  - Space while the buffer is alive is part of the typed text ("New f…"), not a selection; after the pause it selects again.
  - The buffer is a separate `Typeahead` class (`seek(key, labels, current)`): select uses it to search by letters on a closed trigger, when no items are on the page.
- **Pointer:** hovering highlights an item. Leaving an item removes the highlight in menus and keeps it in lists. The collection's `tracksPointer` switches this off for a while: the menu keeps the sub-trigger highlight while the pointer travels the intent zone toward the submenu.
- **Disappearance:** a highlighted item that left the DOM removes the highlight with focus returning to the content in menus, and hands it to the first item in lists.

**Performer check** (unit):
- DOM order after inserting an item in the middle;
- skipping `disabled`;
- wraparound in menus, none in lists;
- typeahead with letter repeat;
- `aria-activedescendant` points at the highlighted item;
- Enter from a foreign button inside the layer does not pick an item.
