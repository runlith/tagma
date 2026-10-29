---
id: 01a155fa-972a-742a-a39f-559855712a25
title: tagma:transition checks the predecessor window with its own SurfaceLoader from its commit sources
ord: 6
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a13d58-e5af-7b43-8425-23fcd7a280ad
  - kind: relates
    to: 01a13d38-e6b4-70e0-9a02-f32136475170
sources:
  - kind: file
    ref: apps/tagma/desktop/scripts/transition.ts
---
The frozen 0.1.x window (`settledPlace`, `successorOf`, `bringToStable`) is gone with 0.1.x compatibility, and with it the "button with the window open" world and reopening the old app in the "new app" world. How an issued release's window follows the new one is no longer visible to `tagma:transition`.

To do: build the predecessor commit's `SurfaceLoader` from `git archive` (bare package imports resolved through `exports`: `node_modules/@runlith` → `packages/*`) and drive it with the same recording window as the new release's window (`desktop/scripts/transition.ts`); return both worlds.

Done: `bun run tagma:transition` over 0.2.0 passes the button world and the new-app world with reopening the old one.
