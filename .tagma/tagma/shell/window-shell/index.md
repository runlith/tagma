---
id: 01a174f2-3d48-7117-95f2-614e3724cd7a
title: Window shell
ord: 46
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "."
      }
    ],
    "id": "app-chrome",
    "kind": "surface"
  }
edges:
  - kind: imports
    to: 01a0c6fd-caf6-71b7-ae07-f6ae0e2f2094
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
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a0fd8b-bee9-7760-9b13-b9847a70e34e
  - kind: imports
    to: 01a0fd8b-beeb-7ef2-bff4-d6d3b824564e
  - kind: imports
    to: 01a0fd8b-bef1-758e-b119-40b1d962023e
  - kind: imports
    to: 01a0fd8b-bef3-77af-90bc-2ea871f4b029
  - kind: imports
    to: 01a0fd8b-bef5-738e-8ee9-97f36cc306ce
  - kind: imports
    to: 01a0fd8b-befd-77ef-ac51-f681d12dd963
  - kind: imports
    to: 01a0fd8b-bf01-77d4-950b-191990491249
  - kind: imports
    to: 01a0fd8b-bf03-7ff9-bfe7-eb4fc6922284
  - kind: imports
    to: 01a0fd8b-bf0b-75ac-870f-109964d4c5ab
  - kind: imports
    to: 01a10326-9d9d-7ddf-8111-37bc50467575
  - kind: imports
    to: 01a10c61-1e17-72d3-b0d5-117293a21200
  - kind: imports
    to: 01a11241-8e1a-7151-a20e-e97daa6db0fc
  - kind: imports
    to: 01a174f2-3d3c-7aba-98fd-93f206137f5a
  - kind: imports
    to: 01a174f2-3d42-7971-98e6-d64d57643bc7
  - kind: imports
    to: 01a174f2-3d44-7a14-9cbf-a66c23e74cc4
  - kind: imports
    to: 01a174f2-3d45-708d-99bc-b9d9a8449383
  - kind: imports
    to: 01a174f2-3d47-7207-a202-bde690fa7bd9
  - kind: imports
    to: 01a174f2-3d51-75fa-8183-c8b41c9696ea
  - kind: imports
    to: 01a174f2-3d52-7cb0-8660-a40d39910e41
  - kind: imports
    to: 01a174f2-3d53-77eb-b835-34ca4f0a6d9b
  - kind: imports
    to: 01a174f2-3d55-75b3-a0ce-6ad72dc811be
  - kind: imports
    to: 01a174f2-3d5a-7431-8610-6fcfbbff045a
  - kind: imports
    to: 01a174f2-3d5c-7f13-b9d4-5983602c4179
  - kind: imports
    to: 01a174f2-3d64-7063-9cdd-f45638c2ca4c
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
    to: 01a193f8-0f6e-7d7b-ab47-f2ac80ffecb0
  - kind: imports
    to: 01a1b1a3-f7a6-751e-9e19-4da75293f5b9
  - kind: imports-tests
    to: 01a0c839-17d3-7d06-a00d-69691aee61f4
  - kind: imports-tests
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: imports-tests
    to: 01a0fd8b-beed-7934-884b-a443f92da92b
  - kind: imports-tests
    to: 01a0fd8b-bef0-716f-98eb-0a3806405a5f
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/app/chrome
---
The desktop window and the browser tab look the same thanks to this shell: a rail of places and projects, a top bar with back-forward and worktree switcher, a status line with server load and failures, columns per route, app menu and command palette. It brings feature views into one window and leaves their content to the features.
