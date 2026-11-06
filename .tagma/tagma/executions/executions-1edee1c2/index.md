---
id: 01a174f2-3d79-76b8-b0ac-d49d1edee1c2
title: Executions
ord: 49
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "."
      },
      {
        "at": "worktrees/testing/",
        "role": "testing"
      }
    ],
    "id": "app-executions",
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
    to: 01a0c83f-4f47-72fe-9b6c-cf30e4e55579
  - kind: imports
    to: 01a0ca95-302a-761c-b835-d02e2f69b0c4
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a0fd8b-beeb-7ef2-bff4-d6d3b824564e
  - kind: imports
    to: 01a0fd8b-bf01-77d4-950b-191990491249
  - kind: imports
    to: 01a0fd8b-bf03-7ff9-bfe7-eb4fc6922284
  - kind: imports
    to: 01a174f2-3d3c-7aba-98fd-93f206137f5a
  - kind: imports
    to: 01a174f2-3d42-7971-98e6-d64d57643bc7
  - kind: imports
    to: 01a174f2-3d44-7a14-9cbf-a66c23e74cc4
  - kind: imports
    to: 01a174f2-3d45-708d-99bc-b9d9a8449383
  - kind: imports
    to: 01a174f2-3d51-75fa-8183-c8b41c9696ea
  - kind: imports
    to: 01a174f2-3d52-7cb0-8660-a40d39910e41
  - kind: imports
    to: 01a174f2-3d53-77eb-b835-34ca4f0a6d9b
  - kind: imports
    to: 01a174f2-3d55-75b3-a0ce-6ad72dc811be
  - kind: imports
    to: 01a174f2-3d69-7e11-b0e3-23748b87c117
  - kind: imports
    to: 01a174f2-3d6d-78f4-877c-f76c78f56704
  - kind: imports
    to: 01a174f2-3d72-7f4e-ae6d-3460a8639e52
  - kind: imports
    to: 01a174f2-3d77-75ec-9d2c-4c481c787f5f
  - kind: imports
    to: 01a1b1a3-f7a6-751e-9e19-4da75293f5b9
  - kind: imports-tests
    to: 01a0c704-a612-7c4c-9f81-5089acc2829b
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/executions
---
Agent and operator terminals and commands: the terminal panel and rendering, commands and processes, their view per worktree. Processes live on the server execution host; the module shows and tracks them.
