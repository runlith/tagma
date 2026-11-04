---
id: 01a174f2-3d7a-7b3a-8012-a1729e843257
title: Model providers
ord: 40
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
    "id": "app-providers",
    "kind": "product"
  }
edges:
  - kind: imports
    to: 01a0c6f2-a586-7323-a199-02c56c81c6f3
  - kind: imports
    to: 01a0c700-4cde-7cce-8b46-dc3859cc3c49
  - kind: imports
    to: 01a0c839-17d3-7d06-a00d-69691aee61f4
  - kind: imports
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: imports
    to: 01a0c83d-a829-7d4b-bfbb-6824de36c9fd
  - kind: imports
    to: 01a0c944-8aa1-7e16-b225-ddc5d1caad35
  - kind: imports
    to: 01a0ca5c-5906-74eb-a8b8-6650cb732496
  - kind: imports
    to: 01a0fd8b-beed-7934-884b-a443f92da92b
  - kind: imports
    to: 01a0fd8b-bf07-7e08-a660-42bdab05dfec
  - kind: imports
    to: 01a10326-9d9d-7ddf-8111-37bc50467575
  - kind: imports
    to: 01a12c51-8120-7250-9703-61feea5c74f4
  - kind: imports
    to: 01a15bd0-13f8-713e-8975-1482ecdb8134
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
    to: 01a174f2-3d6d-78f4-877c-f76c78f56704
  - kind: imports
    to: 01a174f2-3d77-75ec-9d2c-4c481c787f5f
  - kind: imports
    to: 01a174f2-3d79-76b8-b0ac-d49d1edee1c2
  - kind: imports-tests
    to: 01a0c704-a612-7c4c-9f81-5089acc2829b
  - kind: imports-tests
    to: 01a0fd8b-bf06-7d52-a6ca-9e8e1a45453a
  - kind: imports-tests
    to: 01a12ce3-7d6d-71b9-8c1e-d661ac293dd5
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/providers
---
Agents run on provider models, and the operator connects them here: accounts and instances, key and OAuth sign-in, models and their selection catalog, spend and limits.
