---
id: 01a174f2-3d42-7971-98e6-d64d57643bc7
title: Shared interface
ord: 63
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "."
      }
    ],
    "id": "app-shared",
    "kind": "kit"
  }
edges:
  - kind: imports
    to: 01a0c700-4cde-7cce-8b46-dc3859cc3c49
  - kind: imports
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: imports
    to: 01a0c83d-a829-7d4b-bfbb-6824de36c9fd
  - kind: imports
    to: 01a0c83f-4f47-72fe-9b6c-cf30e4e55579
  - kind: imports
    to: 01a0ca5c-5906-74eb-a8b8-6650cb732496
  - kind: imports
    to: 01a0ca95-302a-761c-b835-d02e2f69b0c4
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a10326-9d9d-7ddf-8111-37bc50467575
  - kind: imports
    to: 01a10731-9758-7fff-9500-8b7243059ef8
  - kind: imports
    to: 01a10c94-6a6b-7683-bd66-5bc3878f5962
  - kind: imports
    to: 01a174f2-3d3c-7aba-98fd-93f206137f5a
  - kind: imports-tests
    to: 01a0c704-a612-7c4c-9f81-5089acc2829b
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/shared
---
Here is what many features need and none owns: `ui` components (buttons, menus, dialogs, popovers), the `Theme` port the appearance feature fills, fading text, file and agent icons, seams, drag and drop, `Frame` — the one iframe for pages, MCP App windows and the sites a plugin's view embeds —, and the desktop and browser bridges that composition fills. No domain knowledge lives here: it lives in the features.
