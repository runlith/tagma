---
id: 01a0d56a-99a9-7ac1-9410-7c033624e501
title: "Build: the terminal panel of a place on the Agents page, and the Terminals section's removal"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d56b-ca68-7171-9c36-241f3767a4d0",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0d56a-989a-7212-b4b0-46f491f03b67
  - kind: waits-on
    to: 01a0d56a-99a0-71d8-9308-7014a50c62ee
---
Build [[91f03b67]] whole, in its order. Start at `features/terminals/TerminalTabs.svelte.ts`, which splits into `TerminalPlaces` and `PlaceTabs`, and the chat layout. Done when its acceptance holds, the moved suites protect the same contracts, and `apps/tagma` checks pass.