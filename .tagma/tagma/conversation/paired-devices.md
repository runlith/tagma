---
id: 01a174f2-3d64-7063-9cdd-f45638c2ca4c
title: Paired devices
ord: 42
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "."
      }
    ],
    "id": "app-devices",
    "kind": "product"
  }
edges:
  - kind: imports
    to: 01a0c700-4cde-7cce-8b46-dc3859cc3c49
  - kind: imports
    to: 01a0c839-17d3-7d06-a00d-69691aee61f4
  - kind: imports
    to: 01a0ca5c-5906-74eb-a8b8-6650cb732496
  - kind: imports
    to: 01a10c61-1e17-72d3-b0d5-117293a21200
  - kind: imports
    to: 01a10c94-6a6b-7683-bd66-5bc3878f5962
  - kind: imports
    to: 01a174f2-3d3c-7aba-98fd-93f206137f5a
  - kind: imports
    to: 01a174f2-3d42-7971-98e6-d64d57643bc7
  - kind: imports
    to: 01a174f2-3d52-7cb0-8660-a40d39910e41
  - kind: imports
    to: 01a174f2-3d53-77eb-b835-34ca4f0a6d9b
  - kind: imports
    to: 01a174f2-3d5c-7f13-b9d4-5983602c4179
  - kind: imports
    to: 01a174f2-3d61-78d0-a85f-42a67ddf60a8
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/devices
---
The operator pairs the phone with the machine over QR and receives push notifications: devices section, pairing, the pair list with locking, and this browser's push subscription.
