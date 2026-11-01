---
id: 01a0fd8b-bef6-746f-b533-19bc00ddf0e5
title: Line authorship
ord: 11
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "."
      },
      {
        "at": "contract/service/taskLabels.ts",
        "for": [
          "d962023e",
          "1a45453a",
          "9543a701",
          "be68a750",
          "13182a9f"
        ]
      }
    ],
    "id": "change-record",
    "kind": "substrate",
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
    to: 01a0c0d5-c713-75bd-b78b-0583adeeb4ba
  - kind: imports
    to: 01a0c6ed-5b45-77b0-a47b-9e0ab77b7a93
  - kind: imports
    to: 01a0c6f2-a586-7323-a199-02c56c81c6f3
  - kind: imports
    to: 01a0c702-bcab-7b1f-9440-825f382fa6aa
  - kind: imports
    to: 01a0c703-263a-7a49-8a3d-0bfdc70821a1
  - kind: imports
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: imports
    to: 01a0c83d-be5e-7beb-99fc-b3492a74de70
  - kind: imports
    to: 01a0c944-8aa1-7e16-b225-ddc5d1caad35
  - kind: imports
    to: 01a0ca5d-3b72-7529-8b88-94c413756ad0
  - kind: imports
    to: 01a0ca85-8b21-7009-8bcc-eddc5565be05
  - kind: imports
    to: 01a0d564-ec47-7645-8756-ec405e1647fa
  - kind: imports
    to: 01a0d584-d0b8-7967-9796-a8e3bbddbda9
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a0fd8b-bee9-7760-9b13-b9847a70e34e
  - kind: imports
    to: 01a0fd8b-beeb-7ef2-bff4-d6d3b824564e
  - kind: imports
    to: 01a0fd8b-beef-70cb-81c5-89e59e75d459
  - kind: imports
    to: 01a0fd8b-bef0-716f-98eb-0a3806405a5f
  - kind: imports
    to: 01a0fd8b-bf10-7a02-a086-916b457e7a6c
  - kind: imports
    to: 01a0fd8b-bf12-7d39-abd6-b5ffc43d3272
  - kind: imports
    to: 01a0fd8b-bf14-78e1-9fb7-466fe707d6ca
sources:
  - kind: dir
    ref: apps/tagma/server/src/change-record
  - kind: file
    ref: apps/tagma/server/drizzle/20261025131500_retirement_proof_commit/migration.sql
  - kind: file
    ref: apps/tagma/server/drizzle/20261028212635_command_observed_digest/migration.sql
  - kind: file
    ref: apps/tagma/server/drizzle/20261028212635_command_observed_digest/snapshot.json
  - kind: file
    ref: apps/tagma/server/drizzle/20261101160000_change_command_line/migration.sql
---
Line authorship in a checkout.

Several agents and the operator themselves write into one checkout, and Tagma must know whose lines are whose rather than guessing from git. The module records every edit that passes through tool doors and the operator editor, tracks which uncommitted lines each holder — a session or the operator — keeps, answers who wrote a line, rolls a thread's lines back without touching others', strips added comments, prepares a session's change for commit, and applies to the working files the delta that the commit's steps or hooks transformed. Landing and enforcement make the commit itself and judge the rules.
