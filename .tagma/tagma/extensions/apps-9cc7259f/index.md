---
id: 01a174f2-3d7f-7ca2-9e04-eb039cc7259f
title: Apps
ord: 36
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "."
      }
    ],
    "id": "app-tagma-apps",
    "kind": "product"
  }
edges:
  - kind: imports
    to: 01a0c700-4cde-7cce-8b46-dc3859cc3c49
  - kind: imports
    to: 01a0ca5c-5906-74eb-a8b8-6650cb732496
  - kind: imports
    to: 01a0ca95-302a-761c-b835-d02e2f69b0c4
  - kind: imports
    to: 01a0fd8b-bef1-758e-b119-40b1d962023e
  - kind: imports
    to: 01a0fd8b-bf06-7d52-a6ca-9e8e1a45453a
  - kind: imports
    to: 01a1237e-b7b0-70ab-98b0-c0c63d78b068
  - kind: imports
    to: 01a174f2-3d3c-7aba-98fd-93f206137f5a
  - kind: imports
    to: 01a174f2-3d42-7971-98e6-d64d57643bc7
  - kind: imports
    to: 01a174f2-3d51-75fa-8183-c8b41c9696ea
  - kind: imports
    to: 01a174f2-3d52-7cb0-8660-a40d39910e41
  - kind: imports
    to: 01a174f2-3d53-77eb-b835-34ca4f0a6d9b
  - kind: imports
    to: 01a174f2-3d5a-7431-8610-6fcfbbff045a
  - kind: imports
    to: 01a174f2-3d65-7e23-bb0f-9d871e061782
  - kind: imports
    to: 01a174f2-3d66-76d1-9288-c921d7074a11
  - kind: imports
    to: 01a174f2-3d77-75ec-9d2c-4c481c787f5f
  - kind: imports-tests
    to: 01a0c704-a612-7c4c-9f81-5089acc2829b
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/tagma-apps
---
A Tagma app is an application running inside Tagma, and the module embeds it in the window: app panels and windows, their settings sections, launchers and actions. The app's own interface renders inside the view frame.
