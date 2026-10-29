---
id: 01a11d7f-2fc7-768c-8ee3-1b5c9771e52c
title: Module writes name cards by numbers resolved once in prepare; the freshness check runs in the same unit as the write
ord: 1
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a11d5c-f6ad-71c1-89fb-c64e401d202c
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/rules/modules.ts
  - kind: file
    ref: apps/tagma/server/src/graph/blocks/modules.ts
  - kind: file
    ref: apps/tagma/server/src/graph/contract/wire/modules.ts
---
The `set_module` planner (enforcement) resolves module references once — in prepare, against the call's final card state: a string, `{ id }`, or `{ block }` becomes a card number. A prepared `ModuleWrite` record carries only numbers: positive — an existing card's row, negative — the handle of a card born by the same record (`handle` on the birthing record). The `Blocks.writeModules` writer matches handles to inserted rows, takes names for `for` in bulk, and assembles edges; it never resolves module ids and never checks references.

The writer is trustworthy because `applyModules` checks, inside the same `Act.unit` that runs `writeModules`, the cards themselves against the prepare state (identity, true parent, fields, edges — a recreated card with the same id and root is not the old one) and the live reach of every map rule as `Enforced.reach` returns it: moving a card between ordinary blocks does not change the map but changes what the numbers refer to, and changing a map rule's sources changes what it measures. A change between prepare and the write yields `enforcement-stale`, and numbers never refer to a different card state. Moving the check out of this unit would mean accepting stale numbers as correct and writing a dangling edge or a `for` onto someone else's card. The HEAD check over git (`staleUnder`) stays before the unit so git I/O never holds the writer.

The writer receives the `entries`, `cuts`, `imports`, and `importsTests` collections as final sets already: the delta (`put`/`drop`/`replace`) was applied by the planner to the cards read in prepare, not to whatever lies in the graph later. A field that does not read (`ModuleCard.unreadable`) is not treated by the delta as an empty set: `put`/`drop` refuse, only `replace` can fix it, and editing other fields of a card with an unreadable one stays a card refusal.
