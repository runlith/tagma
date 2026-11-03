---
id: 01a13234-e0d0-7863-b40d-c3e12043c3ca
title: Checkout builds
ord: 38
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
    "id": "checkout-builds",
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
    to: 01a0c6f2-a586-7323-a199-02c56c81c6f3
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a0fd8b-bee9-7760-9b13-b9847a70e34e
  - kind: imports
    to: 01a0fd8b-bef5-738e-8ee9-97f36cc306ce
  - kind: imports
    to: 01a0fd8b-bf01-77d4-950b-191990491249
sources:
  - kind: dir
    ref: apps/tagma/server/src/checkout-builds
---
Tagma's developer takes the next installation from their own checkout: the module watches commits and the working tree, runs the steps the enabled apps of the checkout's project declare before a build (`beforeBuild`, through the `BuildSteps` port composition fills from the apps), builds a cut from HEAD or from the tree, and hands it to the installation module's "next installation" port. It also gives the window the app front straight from the checkout: the `start_dev_surface` operation takes the Vite already answering on this server's dev address, or starts one in the operator's held terminal, and it stops like any terminal. This is the developer adapter: the release composition never plugs it in — there the next installation comes from the release channel, and there is no dev front at all.
