---
id: 01a13283-fc95-76c8-a601-3f5eac2d9a04
title: Release channel
ord: 39
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
    "id": "release-channel",
    "order": [
      [
        "."
      ]
    ]
  }
edges:
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a0fd8b-beeb-7ef2-bff4-d6d3b824564e
  - kind: imports
    to: 01a0fd8b-bef5-738e-8ee9-97f36cc306ce
sources:
  - kind: dir
    ref: apps/tagma/server/src/release-channel
---
A release user receives the next install from the release channel: the module reads the public feed, downloads the release archive with no login, verifies and installs it, filling the installation module's "next install" port. This is the release adapter: for a developer the same port is filled by a checkout build.
