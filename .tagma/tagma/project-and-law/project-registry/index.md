---
id: 01a0fd8b-bee9-7760-9b13-b9847a70e34e
title: Project registry
ord: 47
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "contract/"
      },
      {
        "at": "cli.ts"
      },
      {
        "at": "identity.ts"
      },
      {
        "at": "projects.ts"
      },
      {
        "at": "registration.ts"
      },
      {
        "at": "resolution.ts"
      },
      {
        "at": "store/restore.ts"
      },
      {
        "at": "store/table.ts"
      },
      {
        "at": "testing/",
        "role": "testing"
      },
      {
        "at": "reach.ts"
      }
    ],
    "id": "projects",
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
    to: 01a0fd8b-bf10-7a02-a086-916b457e7a6c
  - kind: imports
    to: 01a0fd8b-bf12-7d39-abd6-b5ffc43d3272
sources:
  - kind: dir
    ref: apps/tagma/server/src/projects
---
One Tagma serves many projects, and this module owns their registry: registering a folder by its root and the key Tagma writes into the repository's git directory, answering which project a path or the current directory belongs to, the global project, groups of projects — a group's own registration with its graph and its ordered members —, removing a project from the list and returning it as the same project when the same folder or its moved repository is added. What a project stores — graph, settings, checkouts, threads — is decided by the modules above; from the registry they receive only the project's identity, its group, and the news of its deletion or of a group's change, on which they react without the registry knowing them.