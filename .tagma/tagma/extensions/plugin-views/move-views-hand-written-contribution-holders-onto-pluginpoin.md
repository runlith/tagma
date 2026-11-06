---
id: 01a1b2bf-bb1a-7610-b997-0a1fc57c5eeb
title: Move views' hand-written contribution holders onto PluginPoints.hold
ord: 12
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1b184-4d43-711b-995e-9495cdfbe445",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a1b21f-77cb-7a9a-9116-31af0d9c29c5
sources:
  - kind: file
    ref: apps/tagma/server/src/views/shelf.ts
---
`results` in `views/shelf.ts`, `surfaces` and `panes` in `views/sections.ts`, and `launchers` in `views/launchers.ts` each keep their own map, register and disposer. `PluginPoints.hold` already does exactly that, so one mechanism should serve all of them, the `composer` point spec-agents adds included. Start after spec-agents lands f1d5e981, which touches `views/shelf.ts`.