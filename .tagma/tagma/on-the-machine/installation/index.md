---
id: 01a0fd8b-bef5-738e-8ee9-97f36cc306ce
title: Installation
ord: 37
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "."
      },
      {
        "at": "testing/",
        "role": "testing"
      }
    ],
    "id": "installation",
    "kind": "product",
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
    to: 01a0c6ed-5b45-77b0-a47b-9e0ab77b7a93
  - kind: imports
    to: 01a0c6ef-834d-72bb-a092-d74196b75e80
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
    to: 01a0fd8b-bef1-758e-b119-40b1d962023e
  - kind: imports
    to: 01a0fd8b-bef3-77af-90bc-2ea871f4b029
  - kind: imports
    to: 01a0fd8b-bf10-7a02-a086-916b457e7a6c
  - kind: imports
    to: 01a0fd8b-bf12-7d39-abd6-b5ffc43d3272
  - kind: imports
    to: 01a0fd8b-bf13-7e86-86fd-2245f20c91d2
  - kind: imports
    to: 01a0fd8b-bf14-78e1-9fb7-466fe707d6ca
  - kind: imports
    to: 01a0fd8b-bf17-7729-bc6f-2284f37a2606
  - kind: imports
    to: 01a1165d-b047-7099-969a-602c520698f4
  - kind: imports
    to: 01a12c51-8120-7250-9703-61feea5c74f4
  - kind: imports-tests
    to: 01a0fd8b-bee9-7760-9b13-b9847a70e34e
  - kind: imports-tests
    to: 01a0fd8b-beeb-7ef2-bff4-d6d3b824564e
  - kind: imports-tests
    to: 01a127e3-cc5c-73fa-99ff-b228d2a60527
sources:
  - kind: dir
    ref: apps/tagma/server/src/installation
---
Tagma is a program on the operator's machine, and the module answers for it as an installation: the data directory and machine registry, the installed releases and the moves between them, the server process and handing it to its successor on restart, initial setup and database compaction. What the running server does is decided by the other modules, and how a release is built, tried and published by the release toolchain; here — where the installation lies, what it is made of, and how it is replaced. Its contract is what both sides of a release boundary read: the manifest, the attempt and restart records, the feed shape and the environment a beside installation runs with.