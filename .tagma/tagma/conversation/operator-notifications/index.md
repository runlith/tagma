---
id: 01a1234b-f246-7286-b7d6-ffd1913a0b97
title: Operator notifications
ord: 37
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "contract/"
      },
      {
        "at": "notify.ts",
        "for": [
          "13182a9f"
        ]
      },
      {
        "at": "receiving.ts",
        "for": [
          "13182a9f"
        ]
      }
    ],
    "id": "notify",
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
      ]
    ]
  }
edges:
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
sources:
  - kind: dir
    ref: apps/tagma/server/src/notify
---
Not everything needing the operator belongs to a thread: a Slack bridge, a trading desk or a trainer wants to say "look" or ask "buy?". The module takes such a notification from an outside caller or a module of the server, holds it open in "Attention" and in push until the operator dismisses it or its sender withdraws it, carries an optional link to what it is about for the app to open, and turns a question into a durable record with an id and an outcome — the first answer or dismissal; a repeated outcome doesn't change it. The outcome reaches the sender until the sender takes it; the receiver that composition connects decides to whom and how to deliver it, and how to show it and wake the phone is the app's and push's call.
