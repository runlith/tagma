---
id: 01a174f2-3d53-77eb-b835-34ca4f0a6d9b
title: Settings
ord: 49
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "."
      }
    ],
    "id": "app-settings",
    "kind": "product",
    "order": [
      [
        "controls/"
      ],
      [
        "."
      ],
      [
        "chips/"
      ]
    ]
  }
edges:
  - kind: imports
    to: 01a0c700-4cde-7cce-8b46-dc3859cc3c49
  - kind: imports
    to: 01a0c839-17d3-7d06-a00d-69691aee61f4
  - kind: imports
    to: 01a0c83d-a829-7d4b-bfbb-6824de36c9fd
  - kind: imports
    to: 01a0c83f-4f47-72fe-9b6c-cf30e4e55579
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a0fd8b-beeb-7ef2-bff4-d6d3b824564e
  - kind: imports
    to: 01a0fd8b-bef1-758e-b119-40b1d962023e
  - kind: imports
    to: 01a10326-9d9d-7ddf-8111-37bc50467575
  - kind: imports
    to: 01a174f2-3d3c-7aba-98fd-93f206137f5a
  - kind: imports
    to: 01a174f2-3d42-7971-98e6-d64d57643bc7
  - kind: imports
    to: 01a174f2-3d52-7cb0-8660-a40d39910e41
  - kind: imports-tests
    to: 01a0c704-a612-7c4c-9f81-5089acc2829b
  - kind: imports-tests
    to: 01a0fd8b-bf01-77d4-950b-191990491249
  - kind: imports-tests
    to: 01a0fd8b-bf07-7e08-a660-42bdab05dfec
  - kind: imports-tests
    to: 01a174f2-3d4c-7763-bb7b-749e7b63e87f
  - kind: imports-tests
    to: 01a174f2-3d51-75fa-8183-c8b41c9696ea
  - kind: imports-tests
    to: 01a174f2-3d55-75b3-a0ce-6ad72dc811be
  - kind: imports-tests
    to: 01a174f2-3d74-74cb-a0f8-1c008f8b93e1
  - kind: imports-tests
    to: 01a174f2-3d77-75ec-9d2c-4c481c787f5f
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/settings
---
The operator changes Tagma behaviour in settings, and the module owns their surface and language: server and browser keys, the project and all-projects layer, sections declared by features, and value controls. Model catalogs for selection arrive through the `ModelChoices` port, which composition fills.
