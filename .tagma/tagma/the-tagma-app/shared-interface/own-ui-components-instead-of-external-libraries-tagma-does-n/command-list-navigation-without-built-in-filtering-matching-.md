---
id: 01a13d48-9aa9-71d0-a2d8-690144500eab
title: "Command list: navigation without built-in filtering, matching is a single app function"
ord: 6
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/shared/ui/command
---
6 consumers. The palette and the worktree switcher filter on their own (`shouldFilter={false}`). Three pickers rely on the bits fuzzy score: `graph/journal/Filters.svelte`, `settings/controls/CatalogPicker.svelte`, `threads/FolderPicker.svelte`. And bits searches by `value` when set, so `CatalogPicker.svelte:73` searches by id rather than the visible label.

**Filtering.** The component does not filter. What to show and in which order is decided by the consumer's model — the owner of its data.
- Matching is a single function in `apps/tagma/app/src/lib/shared`: every query word occurs in the label or in `keywords`, case-insensitively. The palette's `actionMatches` (`features/palette/action.ts`), which has the same semantics, moves onto it too. That gives matching a single owner.
- The three pickers search by visible label; ids, folder paths, and other keys are passed as `keywords`.
- Order is the consumer's original order. There is no score ranking as in bits. The palette's, the switcher's, and the model choice's (`shared/models/choice.ts`) domain rankings stay theirs.
- The consumer renders `Empty` itself when its filtered set has no items, and hides empty groups itself (`CatalogPicker.svelte:70-81`). An always-visible item the consumer simply always renders: "New folder" in `FolderPicker.svelte:90`. `Item` no longer has `keywords` or `forceMount`.

**Parts:**
- `Root`: `value` — the highlighted item, bindable; the palette holds `bind:value={selected}`;
- `Input`;
- `List` (`role="listbox"`);
- `Group`;
- `Item` (`role="option"`): `value`, `onSelect`, `disabled`;
- `Empty` — view only, in the app.

**Keys** — [[91d530fd]] in `aria-activedescendant` mode. Navigation works while focus is in the field: arrows, Home/End, Enter invokes `onSelect` of the highlighted item. Inside the worktree switcher there are buttons, a name field, and a menu, and the list does not touch their keys. If the highlighted item disappears from the set, the first one is highlighted.

**Behaviour changes:** pickers match by label, not by id. Results stand in the original order, not by fuzzy score.

**Performer check** (unit):
- arrows from the field move the highlight;
- Enter invokes `onSelect`;
- disappearance of the highlighted item highlights the first;
- Enter from a button inside the layer does not select an item;
- the matching function finds by label and by `keywords`, and the palette passes its own tests on it.
