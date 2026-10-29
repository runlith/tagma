---
id: 01a17645-77f8-704c-832f-31b8ff39e6e3
title: The module-card step translates boundaries from the project graph itself
ord: 13
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/steps/moduleCards.ts
---
One form translation opens old graphs of different projects, so module knowledge comes from the graph itself, not product templates. An existing card keeps its author text and identity; where there was no card, its former id becomes the name, and an empty description and unset kind keep the unknown as unknown instead of an invented purpose. Paths, edges, and floors move from the project's former document. Several standalone floor-range rules of one module cannot be reduced to one `order` scale without changing the law — the step refuses before edits and asks to merge the restrictions by hand in an edition that understands the old rules. Physical catalog nesting does not set card nesting: a module with children counts as a container and cannot own code.
