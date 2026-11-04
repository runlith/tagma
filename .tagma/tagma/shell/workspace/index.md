---
id: 01a174f2-3d52-7cb0-8660-a40d39910e41
title: Workspace
ord: 48
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "."
      }
    ],
    "id": "app-workspace",
    "kind": "substrate"
  }
edges:
  - kind: imports
    to: 01a0c700-4cde-7cce-8b46-dc3859cc3c49
  - kind: imports
    to: 01a0c839-17d3-7d06-a00d-69691aee61f4
  - kind: imports
    to: 01a0ca5c-5906-74eb-a8b8-6650cb732496
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a0fd8b-bee9-7760-9b13-b9847a70e34e
  - kind: imports
    to: 01a0fd8b-bef1-758e-b119-40b1d962023e
  - kind: imports
    to: 01a0fd8b-bf0d-7231-8383-459013182a9f
  - kind: imports
    to: 01a174f2-3d3c-7aba-98fd-93f206137f5a
  - kind: imports
    to: 01a174f2-3d42-7971-98e6-d64d57643bc7
  - kind: imports
    to: 01a174f2-3d51-75fa-8183-c8b41c9696ea
  - kind: imports
    to: 01a193f8-0f6e-7d7b-ab47-f2ac80ffecb0
  - kind: imports
    to: 01a1a698-f793-7779-8b4b-3e9a010f34d2
  - kind: imports-tests
    to: 01a0c704-a612-7c4c-9f81-5089acc2829b
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/workspace
---
Every app view stands in a project and on a surface, and the module owns that choice: the current project and graph, thread, terminal, commit and git-view addresses, the surface registry, focus, visits, project, graph and thread steps, and the project mark. A view's address is built here, with no knowledge of the module that draws it.
