---
id: 01a10c94-6a6b-7683-bd66-5bc3878f5962
title: Push notifications
ord: 35
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "contract/"
      },
      {
        "at": "push.ts",
        "for": [
          "13182a9f"
        ]
      },
      {
        "at": "webpush/send.ts",
        "for": [
          "13182a9f"
        ]
      }
    ],
    "id": "push",
    "kind": "product",
    "order": [
      [
        "contract/wire/"
      ],
      [
        "contract/service/"
      ],
      [
        "store/"
      ],
      [
        "."
      ],
      [
        "webpush/"
      ]
    ]
  }
edges:
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a0fd8b-bf06-7d52-a6ca-9e8e1a45453a
  - kind: imports
    to: 01a10c61-1e17-72d3-b0d5-117293a21200
  - kind: imports
    to: 01a1234b-f246-7286-b7d6-ffd1913a0b97
sources:
  - kind: dir
    ref: apps/tagma/server/src/push
---
The phone in the pocket learns that the agent waits for the operator, crashed, or finished, with no open application: the server itself sends Web Push to paired devices. The module holds device subscriptions, the VAPID key, and sent marks, watches the threads' "Attention" flows, `notify` notifications, and the device-revocation event; what deserves attention is decided by `threads` and `notify`, and delivery through APNs and FCM by the browser push service.
