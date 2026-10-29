---
id: 01a17344-7348-7f35-80b2-9fc26f89aa71
title: "The window lays out Shell: section column on the left, a scene of page and right area, terminal panel of the current worktree below the scene"
ord: 18
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a15733-ba94-72d4-9e93-90d81d4dd5b3
  - kind: relates
    to: 01a15733-baa1-7d3d-bd19-4933f4f557ea
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/Shell.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/StatusBar.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/AgentsFrame.svelte
---
The layout follows who owns each part. The section column (project agents, knowledge) is project navigation, it is one per section and stands outside the scene; its feature declares it (`columns.ts`), `Shell` draws it. Page and right area are what is open now: the right area belongs to its holder — thread, draft or section. The terminal panel belongs to the current worktree, which the window knows from the page address (`Worktrees.aimed`), so it stands under the whole scene and is on every project page, not inside the thread page. Its button stands at the left end of the status row, right under it: in the top row it switched the panel on the window's far edge.

A page holds neither column nor panel. When the agent column and panel lived inside the thread page, the panel took only the conversation's width and vanished on other branch pages, and the top row had to learn the column width with a separate measurement. The agent column takes the thread it works with from the page's main slot (`ThreadSeats.page`), seated by the thread page via `seatMain`; panels get only the slot's `SidePanes.main` projection from the same call.
