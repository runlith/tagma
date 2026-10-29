---
id: 01a15598-c435-7d56-8ea8-fe2d80668b22
title: The displayed project name is separate from its address
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/workspace/Visits.svelte.ts
  - kind: symbol
    ref: apps/tagma/app/src/lib/features/workspace/mark.ts
    symbol: labelOf
---
The name a person sees in navigation also serves as the initials' basis. Addresses use the registered name: changing words in the interface must not change links and agent calls to the shared graph. Saved window moves are keyed by project id, so renaming does not lose them, and a new project under a deleted one's name does not get its places.
