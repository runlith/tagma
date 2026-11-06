---
id: 01a1b1cd-9d09-7f12-8e88-fafbc52b6e84
title: Appearance in the window
ord: 11
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "."
      }
    ],
    "id": "app-appearance",
    "kind": "product"
  }
edges:
  - kind: imports
    to: 01a0ca5c-5906-74eb-a8b8-6650cb732496
  - kind: imports
    to: 01a0fd8b-beeb-7ef2-bff4-d6d3b824564e
  - kind: imports
    to: 01a174f2-3d3c-7aba-98fd-93f206137f5a
  - kind: imports
    to: 01a174f2-3d42-7971-98e6-d64d57643bc7
  - kind: imports
    to: 01a174f2-3d51-75fa-8183-c8b41c9696ea
  - kind: imports
    to: 01a174f2-3d52-7cb0-8660-a40d39910e41
  - kind: imports
    to: 01a174f2-3d53-77eb-b835-34ca4f0a6d9b
  - kind: imports
    to: 01a174f2-3d55-75b3-a0ce-6ad72dc811be
  - kind: imports
    to: 01a174f2-3d8d-7fa1-bc61-069b96400e93
  - kind: imports
    to: 01a18921-8504-7058-9d53-62c5e9aa47fc
  - kind: imports
    to: 01a1b1a3-f7a6-751e-9e19-4da75293f5b9
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/appearance
---
Every window of the person paints the theme and light or dark they chose, follows a change made anywhere at once, and opens already painted. This module holds `Appearance`, which fills the `Theme` port from the `settings.watch` and `appearance.subscribe` feeds, paints the window (one adopted stylesheet, the `dark` class, the address-bar colour) and keeps the boot paint `app.html` reads before the bundle; the rail menu's Theme row, the palette entries, the Appearance settings section with its `theme` choice set, and the theme rows of a plugin's card. What a theme is and whether it keeps the state colours' meaning is the server's `appearance`; the terminal, framed views and the canvas only read `Theme.look`.