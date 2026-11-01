---
id: 01a19420-caa2-79d8-aedc-d3d07c7bfef4
title: Thread run popover keeps one width, shows addresses, opens on click, and opens unplaced terminals at their holder
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19421-69cf-70c0-8ff2-b220ea050d62",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a19420-92b3-74b1-b0e9-37b06636131b
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47bf37a0e8a9
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/WorkLine.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/WorkPeek.svelte
---
The app half of the spec: `WorkPeek`, `WorkLine`, `CommandStatus` per the spec's popover decision and the mockup, and an unplaced held terminal opening as a tab of its holder thread (`opens.ts`, `worktrees/Terminals.svelte.ts`). Feature 37a0e8a9 is rewritten to the new behaviour in the same change.