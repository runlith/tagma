---
id: 01a174f2-3d3c-7aba-98fd-93f206137f5a
title: Server connection
ord: 62
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
    "id": "app-wire",
    "kind": "substrate"
  }
edges:
  - kind: imports
    to: 01a0c700-4cde-7cce-8b46-dc3859cc3c49
  - kind: imports
    to: 01a0c702-bcab-7b1f-9440-825f382fa6aa
  - kind: imports
    to: 01a0c944-8aa1-7e16-b225-ddc5d1caad35
  - kind: imports
    to: 01a0ca5c-5906-74eb-a8b8-6650cb732496
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a0fd8b-bee9-7760-9b13-b9847a70e34e
  - kind: imports
    to: 01a0fd8b-beed-7934-884b-a443f92da92b
  - kind: imports
    to: 01a0fd8b-bef0-716f-98eb-0a3806405a5f
  - kind: imports
    to: 01a0fd8b-bef1-758e-b119-40b1d962023e
  - kind: imports
    to: 01a0fd8b-bef5-738e-8ee9-97f36cc306ce
  - kind: imports
    to: 01a0fd8b-bef6-746f-b533-19bc00ddf0e5
  - kind: imports
    to: 01a0fd8b-befd-77ef-ac51-f681d12dd963
  - kind: imports
    to: 01a0fd8b-befe-744b-876f-36f2f3b6b585
  - kind: imports
    to: 01a0fd8b-bf00-7c53-8428-280109c9ec78
  - kind: imports
    to: 01a0fd8b-bf01-77d4-950b-191990491249
  - kind: imports
    to: 01a0fd8b-bf03-7ff9-bfe7-eb4fc6922284
  - kind: imports
    to: 01a0fd8b-bf06-7d52-a6ca-9e8e1a45453a
  - kind: imports
    to: 01a0fd8b-bf07-7e08-a660-42bdab05dfec
  - kind: imports
    to: 01a0fd8b-bf0a-71f6-96fa-2857be68a750
  - kind: imports
    to: 01a0fd8b-bf0b-75ac-870f-109964d4c5ab
  - kind: imports
    to: 01a0fd8b-bf0c-778a-8cab-a767627a3d25
  - kind: imports
    to: 01a0fd8b-bf0d-7231-8383-459013182a9f
  - kind: imports
    to: 01a10731-9758-7fff-9500-8b7243059ef8
  - kind: imports
    to: 01a10c61-1e17-72d3-b0d5-117293a21200
  - kind: imports
    to: 01a11241-8e1a-7151-a20e-e97daa6db0fc
  - kind: imports
    to: 01a1180d-2c83-7a2c-884f-0a8c9f0b5fe1
  - kind: imports
    to: 01a1234b-f246-7286-b7d6-ffd1913a0b97
  - kind: imports
    to: 01a1237e-b7b0-70ab-98b0-c0c63d78b068
  - kind: imports
    to: 01a14828-bfa9-7e91-992b-e05c97a922df
  - kind: imports
    to: 01a1488c-954c-76bc-bfcd-42d64103030b
  - kind: imports
    to: 01a18895-c4d0-788c-9b73-3b1f94035751
  - kind: imports
    to: 01a188f5-84f7-767d-96d1-6554722cb1b9
  - kind: imports-tests
    to: 01a0c704-a612-7c4c-9f81-5089acc2829b
  - kind: imports-tests
    to: 01a13b4d-7a3d-7729-955f-a344b43ff1ba
  - kind: imports-tests
    to: 01a174f2-3d8d-7fa1-bc61-069b96400e93
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/wire
---
The app knows the server only through the wire, and the module holds it: door calls, the live connection with subscriptions and its failures, the server address, restart, and the `told` answer dictionary. Features decide what to ask the server and how to show the answer.
