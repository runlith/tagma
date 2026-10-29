---
id: 01a13d48-9aa9-71d0-a2d8-69007e9ccf82
title: "Select on the kit stack: single value, list with highlighted selection, no scroll-lock"
ord: 5
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/shared/ui/select
---
5 consumers, one value. Two of them live inside dialogs: `worktrees/NewWorktreeDialog.svelte:76` and `threads/library/AgentDefinitionEditor.svelte` in the agent library.

**Parts:**
- `Root`: `value`, `onValueChange`, `disabled`;
- `Trigger` shows the selected item's label;
- `Content` no narrower than the trigger, height no more than available from [[313c7343]];
- `Item`: `value`, `label`, `disabled`; accepts child content and other attributes — its own markup (`speech/Pick.svelte:34-41`, `providers/instances/FieldControl.svelte:76`) and `title` (`settings/controls/ChoiceControl.svelte:80`).

**Behaviour.**
- The list is [[91d530fd]] in `aria-activedescendant` mode. On open, the selected item is highlighted.
- On a closed trigger, ArrowDown, ArrowUp, Enter, and Space open the list, while typeahead changes the value without opening it. Tab from an open list closes it and moves on from the trigger.
- The select does not lock page scroll. No scroll buttons: the list scrolls itself.

**Performer check** (unit):
- a pick changes the value and closes the list;
- opening highlights the selected item;
- typeahead on a closed trigger;
- a select opened inside a modal dialog receives focus and keys.
