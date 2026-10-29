---
id: 01a12812-89b3-78cf-8d61-fdf662f24a1d
title: "Conditional spread cleanup: app and UI packages"
ord: 4
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a127f0-4ce7-7edb-adb0-9eb640ffd688
sources:
  - kind: dir
    ref: apps/tagma/app
  - kind: dir
    ref: packages/chat-ui
  - kind: dir
    ref: packages/query
---
The [[40ffd688|spec]] step-4 procedure over `apps/tagma/app`, `packages/chat-ui`, `packages/query`, `packages/layer`, `packages/highlight`, `packages/code-editor` — about 320 sites. Svelte 5 takes the prop fallback on `undefined`; TanStack options merged over defaults go to overlay at the owner, or a permission. Done when the `optional-spread` inspection over these areas finds only recorded needed sites, and typecheck and tests are green.
