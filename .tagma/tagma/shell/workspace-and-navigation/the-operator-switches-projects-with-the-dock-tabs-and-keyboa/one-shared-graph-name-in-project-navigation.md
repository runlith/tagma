---
id: 01a15597-2e72-7137-993c-1c62396a6065
title: One Shared graph name in project navigation
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15594-7759-7c41-89ef-ef97355b03e6",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/workspace/mark.ts
---
The shared display-name owner is connected to the projects list, dock, tabs, switcher, menu, header, palette, window title and the "Attention" filter. Initials compute from the display name; global identity, addresses and saved moves do not change. Three existing project-search and address tests passed. An independent review found a direct `active.name` output in the "Attention" filter; the output moved to the same owner. App typecheck passes with the existing a11y warning in CastView.svelte; the interface was not visually checked.
