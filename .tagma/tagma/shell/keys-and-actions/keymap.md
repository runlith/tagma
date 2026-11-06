---
id: 01a174f2-3d44-7a14-9cbf-a66c23e74cc4
title: Keymap
ord: 1
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "."
      }
    ],
    "id": "app-keys",
    "kind": "kit"
  }
edges:
  - kind: imports
    to: 01a0c700-4cde-7cce-8b46-dc3859cc3c49
  - kind: imports
    to: 01a0ca95-302a-761c-b835-d02e2f69b0c4
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a174f2-3d42-7971-98e6-d64d57643bc7
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/app/keys
---
Features declare key bindings, and the map holds them in one list: the last declared binding wins, presses in the window and in the desktop embedded-browser frame arrive at one map, and the desktop is told which bindings to intercept. What a key does is decided by the feature that declared it.
