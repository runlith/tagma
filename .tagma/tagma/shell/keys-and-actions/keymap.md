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
Every key that does something a person can name runs an action by its id. This module is that mechanism and imports no feature. `resolveKeys` builds one table from four layers, highest first: the chords the host keeps (a port its composition fills), the person's chords, Tagma's defaults, then plugins by install rank. A chord taken in a place displaces the same chord lower in that place, and a global chord shares every place. The keymap holds the table handed to it and dispatches: taps in the bubble phase, holds in the capture phase. A press runs the action's handler chain, latest first, and then the action's own run through the `ActionRunner` port. The keymap answers `keysOf`, `spell` and `actionAt` for labels and regions, captures a new chord, and publishes the window's chords and globals to the desktop shell. What an action does and which chords it proposes stay with the feature that declares it.