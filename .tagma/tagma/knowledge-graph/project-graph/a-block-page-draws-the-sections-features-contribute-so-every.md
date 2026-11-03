---
id: 01a1a14a-4fe1-76d3-b631-346a76a7786f
title: A block page draws the sections features contribute, so every place that opens it shows the same page
ord: 19
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/block/sections.ts
---
The graph module cannot import the features that know more about a block — the rules module imports the graph — so a feature contributes a section to the `BlockSections` point from its own layer, as the rules module contributes a rule's check, strictness and refused commits. Every host of `BlockPage` — the Knowledge page, a right-hand tab, a thread's tab — then draws the same sections. A slot only the route filled was rejected: it left a rule opened beside a thread without its check, and beside is where a link from the feed opens by default.

A section decides itself whether it applies to the block it is given; the page renders every contributed section and holds its first frame until each section's `ready` answers.