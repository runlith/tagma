---
id: 01a0fd8b-bf0b-75ac-870f-109964d4c5ab
title: HTTP door
ord: 178
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "contract/wire/Api.ts"
      },
      {
        "at": "contract/wire/Caller.ts"
      },
      {
        "at": "contract/wire/CallLog.ts"
      },
      {
        "at": "contract/wire/checkouts.ts"
      },
      {
        "at": "contract/wire/health.ts"
      },
      {
        "at": "contract/wire/operations.ts"
      },
      {
        "at": "contract/wire/SchemaRefusal.ts"
      },
      {
        "at": "contract/wire/threads.ts"
      },
      {
        "at": "."
      },
      {
        "at": "callLog.ts"
      },
      {
        "at": "door.ts"
      },
      {
        "at": "schemaRefusal.ts"
      }
    ],
    "id": "http",
    "kind": "surface",
    "order": [
      [
        "contract/wire/"
      ],
      [
        "."
      ]
    ]
  }
edges:
  - kind: imports
    to: 01a0c944-8aa1-7e16-b225-ddc5d1caad35
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a0fd8b-bef0-716f-98eb-0a3806405a5f
  - kind: imports
    to: 01a0fd8b-bef5-738e-8ee9-97f36cc306ce
  - kind: imports
    to: 01a0fd8b-bf02-7b35-8c99-f0b29bb175ec
  - kind: imports
    to: 01a0fd8b-bf0a-71f6-96fa-2857be68a750
sources:
  - kind: dir
    ref: apps/tagma/server/src/http
---
The app and the CLI talk to the server over HTTP, and the module is that door: the declared API, the call log, and one refusal shape for a bad request. The door takes the request and returns the answer; execution is invocation's business.
