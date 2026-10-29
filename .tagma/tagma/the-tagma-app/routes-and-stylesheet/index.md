---
id: 01a174f2-3d4e-7357-8bd6-5f243f3e0540
title: Routes and stylesheet
ord: 65
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "."
      }
    ],
    "id": "app-routes",
    "kind": "surface"
  }
edges:
  - kind: imports
    to: 01a0c700-4cde-7cce-8b46-dc3859cc3c49
  - kind: imports
    to: 01a0fd8b-bef1-758e-b119-40b1d962023e
  - kind: imports
    to: 01a0fd8b-bf0b-75ac-870f-109964d4c5ab
  - kind: imports
    to: 01a10c94-6a6b-7683-bd66-5bc3878f5962
  - kind: imports
    to: 01a14828-bfa9-7e91-992b-e05c97a922df
  - kind: imports
    to: 01a174f2-3d3c-7aba-98fd-93f206137f5a
  - kind: imports
    to: 01a174f2-3d42-7971-98e6-d64d57643bc7
  - kind: imports
    to: 01a174f2-3d48-7117-95f2-614e3724cd7a
  - kind: imports
    to: 01a174f2-3d4a-70c5-88a6-b9c12c0881ab
  - kind: imports
    to: 01a174f2-3d4c-7763-bb7b-749e7b63e87f
  - kind: imports
    to: 01a174f2-3d52-7cb0-8660-a40d39910e41
  - kind: imports
    to: 01a174f2-3d64-7063-9cdd-f45638c2ca4c
  - kind: imports
    to: 01a174f2-3d6d-78f4-877c-f76c78f56704
  - kind: imports
    to: 01a174f2-3d72-7f4e-ae6d-3460a8639e52
  - kind: imports
    to: 01a174f2-3d74-74cb-a0f8-1c008f8b93e1
  - kind: imports
    to: 01a174f2-3d77-75ec-9d2c-4c481c787f5f
  - kind: imports
    to: 01a174f2-3d7f-7ca2-9e04-eb039cc7259f
  - kind: imports
    to: 01a174f2-3d97-7315-8204-34ae9103ad03
sources:
  - kind: dir
    ref: apps/tagma/app/src/routes
  - kind: file
    ref: apps/tagma/app/src/app.css
  - kind: file
    ref: apps/tagma/app/src/service-worker.ts
---
The address in the window is a SvelteKit route: project, graph, block, chat, checkout, journal, rules, calls, apps, settings, pairing and desktop windows are mounted by composition and their feature's view. The service worker and the app stylesheet with theme tokens, loaded by the root layout, live here too.
