---
id: 01a1b1a3-f7a6-751e-9e19-4da75293f5b9
title: Appearance
ord: 54
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "contract/"
      },
      {
        "at": "appearance.ts"
      }
    ],
    "id": "appearance",
    "order": [
      [
        "contract/wire/"
      ],
      [
        "contract/service/"
      ],
      [
        "."
      ]
    ]
  }
edges:
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a18921-8504-7058-9d53-62c5e9aa47fc
sources:
  - kind: dir
    ref: apps/tagma/server/src/appearance
---
A person changes how Tagma looks by picking a theme and light or dark, once for every window and device, and the state colours keep their meaning whichever theme stands. This module owns the theme format, Tagma's own theme as data, the one resolution of a theme into the window's tokens and the terminal's palette, the check that keeps failure red, waiting and change blue, done green, work amber and here gold, the `themes` point plugins write into, the person's `appearance.*` keys with their section, and the `appearance.subscribe` feed of offered themes. Painting a window is the client's; storing the keys is `settings`'; publishing a plugin's contributions is `plugin-host`'s.