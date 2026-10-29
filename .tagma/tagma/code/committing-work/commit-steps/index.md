---
id: 01a1138f-eb48-7270-a39f-b386a1c2b760
title: Commit steps
ord: 8
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "contract/"
      },
      {
        "at": "commit-steps.ts",
        "for": [
          "13182a9f"
        ]
      },
      {
        "at": "shape.ts",
        "for": [
          "13182a9f"
        ]
      }
    ],
    "id": "commit-steps",
    "kind": "product",
    "order": [
      [
        "contract/"
      ],
      [
        "."
      ]
    ]
  }
edges:
  - kind: imports
    to: 01a0c0d5-c713-75bd-b78b-0583adeeb4ba
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a0fd8b-bef0-716f-98eb-0a3806405a5f
  - kind: imports
    to: 01a0fd8b-bef6-746f-b533-19bc00ddf0e5
  - kind: imports
    to: 01a0fd8b-bf01-77d4-950b-191990491249
  - kind: imports
    to: 01a1572e-6c3b-70eb-8a81-026d8fda30d8
sources:
  - kind: dir
    ref: apps/tagma/server/src/commit-steps
---
The team declares in its `tagma.config.ts` `format` section what brings every Tagma commit to its shape — formatter, import sorting, linter --fix — and Tagma runs those commands over the commit version in the commit tree and records the result in the commit. The module takes the commands from the commit version's `Config`, selects their files, runs the commands, and fills the change record's CommitShape port; reading and executing the config is `config`'s business, while the commit itself, its judgment, and delivery of the delta to working files are done by landing, enforcement and the change record.
