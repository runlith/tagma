---
id: 01a174f2-3d4c-7763-bb7b-749e7b63e87f
title: App composition
ord: 64
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
      },
      {
        "at": "slotWorld.ts",
        "role": "testing"
      },
      {
        "at": "TestHost.svelte",
        "role": "testing"
      }
    ],
    "id": "app-composition",
    "kind": "substrate",
    "order": [
      [
        "opening/",
        "shell/"
      ],
      [
        "."
      ]
    ]
  }
edges:
  - kind: imports
    to: 01a0c6fd-caf6-71b7-ae07-f6ae0e2f2094
  - kind: imports
    to: 01a0c700-4cde-7cce-8b46-dc3859cc3c49
  - kind: imports
    to: 01a0c839-17d3-7d06-a00d-69691aee61f4
  - kind: imports
    to: 01a0c83d-a829-7d4b-bfbb-6824de36c9fd
  - kind: imports
    to: 01a0ca95-302a-761c-b835-d02e2f69b0c4
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a0fd8b-bef1-758e-b119-40b1d962023e
  - kind: imports
    to: 01a0fd8b-bf0b-75ac-870f-109964d4c5ab
  - kind: imports
    to: 01a0fd8b-bf0d-7231-8383-459013182a9f
  - kind: imports
    to: 01a10c61-1e17-72d3-b0d5-117293a21200
  - kind: imports
    to: 01a174f2-3d3c-7aba-98fd-93f206137f5a
  - kind: imports
    to: 01a174f2-3d42-7971-98e6-d64d57643bc7
  - kind: imports
    to: 01a174f2-3d44-7a14-9cbf-a66c23e74cc4
  - kind: imports
    to: 01a174f2-3d45-708d-99bc-b9d9a8449383
  - kind: imports
    to: 01a174f2-3d48-7117-95f2-614e3724cd7a
  - kind: imports
    to: 01a174f2-3d4a-70c5-88a6-b9c12c0881ab
  - kind: imports
    to: 01a174f2-3d51-75fa-8183-c8b41c9696ea
  - kind: imports
    to: 01a174f2-3d52-7cb0-8660-a40d39910e41
  - kind: imports
    to: 01a174f2-3d53-77eb-b835-34ca4f0a6d9b
  - kind: imports
    to: 01a174f2-3d55-75b3-a0ce-6ad72dc811be
  - kind: imports
    to: 01a174f2-3d5c-7f13-b9d4-5983602c4179
  - kind: imports
    to: 01a174f2-3d5e-76b4-a49d-03ac92f40b76
  - kind: imports
    to: 01a174f2-3d60-7971-a19a-ce507adcadad
  - kind: imports
    to: 01a174f2-3d61-78d0-a85f-42a67ddf60a8
  - kind: imports
    to: 01a174f2-3d64-7063-9cdd-f45638c2ca4c
  - kind: imports
    to: 01a174f2-3d65-7e23-bb0f-9d871e061782
  - kind: imports
    to: 01a174f2-3d67-75cf-b329-5f82212858cf
  - kind: imports
    to: 01a174f2-3d69-7e11-b0e3-23748b87c117
  - kind: imports
    to: 01a174f2-3d6d-78f4-877c-f76c78f56704
  - kind: imports
    to: 01a174f2-3d72-7f4e-ae6d-3460a8639e52
  - kind: imports
    to: 01a174f2-3d74-74cb-a0f8-1c008f8b93e1
  - kind: imports
    to: 01a174f2-3d77-75ec-9d2c-4c481c787f5f
  - kind: imports
    to: 01a174f2-3d79-76b8-b0ac-d49d1edee1c2
  - kind: imports
    to: 01a174f2-3d7a-7b3a-8012-a1729e843257
  - kind: imports
    to: 01a174f2-3d7f-7ca2-9e04-eb039cc7259f
  - kind: imports
    to: 01a174f2-3d87-7c0f-a1ab-7d1319afd604
  - kind: imports
    to: 01a174f2-3d8d-7fa1-bc61-069b96400e93
  - kind: imports
    to: 01a174f2-3d92-73ae-b7d2-464cc89f382f
  - kind: imports
    to: 01a174f2-3d95-7a65-a9be-c433de4f491f
  - kind: imports
    to: 01a174f2-3d97-7315-8204-34ae9103ad03
  - kind: imports
    to: 01a1892f-19c3-73c9-ae5e-7d7993106e20
  - kind: imports
    to: 01a1b1b1-36e8-7b8b-b971-352987dd539d
  - kind: imports
    to: 01a1b1cd-9d09-7f12-8e88-fafbc52b6e84
  - kind: imports-tests
    to: 01a0c704-a612-7c4c-9f81-5089acc2829b
  - kind: imports-tests
    to: 01a0c944-8aa1-7e16-b225-ddc5d1caad35
  - kind: imports-tests
    to: 01a0ca5c-5906-74eb-a8b8-6650cb732496
  - kind: imports-tests
    to: 01a0fd8b-bf06-7d52-a6ca-9e8e1a45453a
  - kind: imports-tests
    to: 01a13b4d-7a3d-7729-955f-a344b43ff1ba
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/app
  - kind: file
    ref: apps/tagma/app/src/manifest.ts
---
The app is features brought together, and they are brought together here: layers of services by level, feature contributions — surfaces, tab kinds, settings sections, link kinds, section columns, palette actions — gathered into lower-module registry ports (`SurfaceRegistry`, `PaneRegistry`, `SectionRegistry`, `LinkRegistry`, `ColumnRegistry`, `ActionRegistry`), lower-module ports that upper ones fill (`ThreadPlaces`, `PickScreen`, `CheckoutScreen`, `MarkdownPreview`, `ModelChoices`, `PageTeams`), server admission, the root component, shell choice, and test rigs from real modules. No domain logic lives here: it lives in the features.
