---
id: 01a1845e-9bda-7c21-84cd-003d5d864d92
title: "The tag vocabulary is one per project scope: a block is read with its own project's vocabulary, not the window's"
ord: 15
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/TagCatalog.svelte.ts
---
A row is shown in an outline only while its `actions.revision` equals the vocabulary revision the reader holds, so a vocabulary of another project hides every row: a block tab holding another project once showed that project's root with an empty outline, and its statuses read through the wrong lifecycle. `TagCatalog` therefore stands on the project rung and reads `ProjectRung.Current`; whatever holds a project — a block tab, another home's thread tab, the settings page holding the project it shows — resolves the vocabulary of what it holds. A consumer resolves it once and keeps that project's instance, so a surface whose project can change under a mounted subtree holds that project and remounts on the change instead of reading the window's scope. The command palette, standing outside every project scope, takes it from the graph place it already holds, and has none while no project is open.