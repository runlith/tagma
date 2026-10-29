---
id: 01a17d2b-ffc2-717d-8c2a-e2e2b63c83c7
title: Window offers the update with a new host as a non-modal card with a price, and the "Tagma" chip holds it until decided
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17ae0-48f6-7cff-9adb-353003be8a0d",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a17d2b-ffc2-717d-8c2a-e2e056ff6fb0
  - kind: waits-on
    to: 01a17d2b-ffc2-717d-8c2a-e2e1d352bac7
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/NoticeCard.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/StandingChip.svelte
---
The offer card in `NoticeCards`: what will close (up to three running programs by name, the rest by count), `Update and end N`, `Later`, the cross equals `Later`, `Show all` with Running, Agent commands, Idle shells groups. The "Tagma" chip is amber "update ready", with the finished installation's card in the popover carrying the same price and button. A regular update is the same card saying terminals will survive it. A closed terminal's tab says it ended with the update that needed a new host. For a server on someone else's host, the same card replaces raw rows above terminals and refusal toasts for terminal acts.
