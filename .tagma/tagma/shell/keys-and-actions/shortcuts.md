---
id: 01a1b1b1-36e8-7b8b-b971-352987dd539d
title: Shortcuts
ord: 2
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "."
      }
    ],
    "id": "app-shortcuts",
    "kind": "product"
  }
edges:
  - kind: imports
    to: 01a0c700-4cde-7cce-8b46-dc3859cc3c49
  - kind: imports
    to: 01a0ca95-302a-761c-b835-d02e2f69b0c4
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a0fd8b-beeb-7ef2-bff4-d6d3b824564e
  - kind: imports
    to: 01a174f2-3d3c-7aba-98fd-93f206137f5a
  - kind: imports
    to: 01a174f2-3d42-7971-98e6-d64d57643bc7
  - kind: imports
    to: 01a174f2-3d44-7a14-9cbf-a66c23e74cc4
  - kind: imports
    to: 01a174f2-3d51-75fa-8183-c8b41c9696ea
  - kind: imports
    to: 01a174f2-3d52-7cb0-8660-a40d39910e41
  - kind: imports
    to: 01a174f2-3d53-77eb-b835-34ca4f0a6d9b
  - kind: imports-tests
    to: 01a0c704-a612-7c4c-9f81-5089acc2829b
  - kind: imports-tests
    to: 01a174f2-3d48-7117-95f2-614e3724cd7a
  - kind: imports-tests
    to: 01a174f2-3d77-75ec-9d2c-4c481c787f5f
  - kind: imports-tests
    to: 01a1892f-19c3-73c9-ae5e-7d7993106e20
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/shortcuts
---
A person presses a key and something he can name happens, wherever the key came from: Tagma, a plugin or himself. This module computes the window's one key table from every action's defaults, the person's own chords kept in `shortcuts.bindings` and the chords the host keeps (the `ShellKeys` port its composition fills per host), and hands it to the keymap once all three were heard. It draws the Shortcuts section and the chord control the Speech card reuses, and owns the one chord change every screen makes — capture, a grant for every app, a plugin card's grant — which asks before taking a chord another action holds, with the one line that says so. Dispatch, regions and the capture of a press stay with the keymap; what each action does stays with its feature.