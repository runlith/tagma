---
id: 01a1617f-eafd-7ac1-be7e-323c3108e857
title: Code navigation
ord: 16
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "contract/"
      },
      {
        "at": "navigation.ts"
      }
    ],
    "id": "navigation",
    "order": [
      [
        "contract/wire/"
      ],
      [
        "contract/service/"
      ],
      [
        "."
      ]
    ]
  }
edges:
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a0fd8b-bee9-7760-9b13-b9847a70e34e
  - kind: imports
    to: 01a0fd8b-beeb-7ef2-bff4-d6d3b824564e
  - kind: imports
    to: 01a0fd8b-bef0-716f-98eb-0a3806405a5f
  - kind: imports
    to: 01a0fd8b-bf10-7a02-a086-916b457e7a6c
  - kind: imports
    to: 01a16166-1402-7837-8a74-f7f8411a495f
  - kind: imports-tests
    to: 01a0c6ed-5b45-77b0-a47b-9e0ab77b7a93
  - kind: imports-tests
    to: 01a13b4d-7a3d-7729-955f-a344b43ff1ba
  - kind: imports-tests
    to: 01a16190-8c9a-7c35-9e7e-98c57c50fada
sources:
  - kind: dir
    ref: apps/tagma/server/src/navigation
---
The agent asks where a symbol is declared and where its occurrences are, and gets the answer at once, while the machine yields navigation no more memory and CPU than it can spare. The `navigation.enabled` setting turns navigation on for the operator's every project or for one project; by default it is off. Switching off stops the engines, withdraws the definition and uses offer, and refuses an arrived call. When on, the module holds the machine's navigation engines: one per repository, started on the first question, with its checkouts connected — base and worktrees — a generation change after a crash, a question queue, each checkout's change stream and agent writes into the engine, the machine's budget, rest for long-unasked worktrees, and engine eviction for space; it also declares the definition and uses operations and the engine-state read. The navigation kit decides how the answer is built; the adapter supplied by composition decides the engine process and its language.
