---
id: 01a14b95-6bb6-7dc8-865e-0c2edb2075e1
title: A closed select searches letters by item labels in a detached element, not by their page markup
ord: 19
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a13d48-9aa9-71d0-a2d8-69007e9ccf82
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/shared/ui/select/select-content.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/shared/ui/select/select-item.svelte
  - kind: file
    ref: packages/primitives/src/select.svelte.ts
---
Letter search on a closed trigger changes the value, while no items stand on the page: the list is not rendered. So `Content` renders children in two places:
- the open list — into the portal, where `Item` draws the item and joins the collection ([[91d530fd]]);
- the closed one — into `select.shelf`, an element detached from the document, where `Item` draws an empty `span` label and yields `{ value, label, disabled }` via `select.label`.

Labels stand in the detached tree in item order, and search sorts them by DOM, like the collection. So inserting and rearranging items with the list closed is immediately visible to search. Off-document, labels enter neither layout, nor the accessibility tree, nor the neighboring consumer's selectors.

Its place `Item` learns from `select.listed()` at creation: the same `open` condition the branch is chosen by. During outro both branches live, but the leaving branch is inactive (`INERT`) in Svelte and creates no new items, so only the closed one yields labels.

Three alternatives rejected:
- items hidden in the document render the consumer's markup for every closed select;
- registration without DOM knows only creation order: an inserted or rearranged item would not search in order;
- an `items` prop at `Root` makes the consumer list items twice.
