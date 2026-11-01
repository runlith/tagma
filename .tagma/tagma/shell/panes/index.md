---
id: 01a174f2-3d45-708d-99bc-b9d9a8449383
title: Panes
ord: 45
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "."
      },
      {
        "at": "testing.ts",
        "role": "testing"
      }
    ],
    "id": "app-panes",
    "kind": "substrate"
  }
edges:
  - kind: imports
    to: 01a0c700-4cde-7cce-8b46-dc3859cc3c49
  - kind: imports
    to: 01a0c83d-a829-7d4b-bfbb-6824de36c9fd
  - kind: imports
    to: 01a0c83f-4f47-72fe-9b6c-cf30e4e55579
  - kind: imports
    to: 01a0ca5c-5906-74eb-a8b8-6650cb732496
  - kind: imports
    to: 01a0ca95-302a-761c-b835-d02e2f69b0c4
  - kind: imports
    to: 01a174f2-3d3c-7aba-98fd-93f206137f5a
  - kind: imports
    to: 01a174f2-3d42-7971-98e6-d64d57643bc7
  - kind: imports
    to: 01a174f2-3d44-7a14-9cbf-a66c23e74cc4
  - kind: imports
    to: 01a174f2-3d52-7cb0-8660-a40d39910e41
  - kind: imports
    to: 01a174f2-3d55-75b3-a0ce-6ad72dc811be
  - kind: imports
    to: 01a193f8-0f6e-7d7b-ab47-f2ac80ffecb0
  - kind: imports-tests
    to: 01a0c704-a612-7c4c-9f81-5089acc2829b
  - kind: imports-tests
    to: 01a174f2-3d51-75fa-8183-c8b41c9696ea
  - kind: imports-tests
    to: 01a174f2-3d74-74cb-a0f8-1c008f8b93e1
  - kind: imports-tests
    to: 01a174f2-3d7f-7ca2-9e04-eb039cc7259f
  - kind: imports-tests
    to: 01a174f2-3d8d-7fa1-bc61-069b96400e93
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/app/panes
---
Left of the main view a section's column (agents, knowledge, plugins) stands in one frame this module draws: its width held by a seam the reader drags, stored across windows, collapsing when dragged below its minimum, and mirrored by a handle in the top row. Right of the main view the operator keeps panes — files, pages, terminals, threads — in tabs and stacks, and the module owns that layout: the registry of pane kinds declared by features, the right area, tabs and their layouts, the palette pane. Where a thread opens its pane is answered by the `ThreadPlaces` port: composition fills it with thread places, so lower features open thread panes without knowing the threads module.
