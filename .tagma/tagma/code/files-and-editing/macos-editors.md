---
id: 01a1555c-b58b-7500-baa0-a5f0342b68d0
title: macOS editors
ord: 14
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "."
      }
    ],
    "id": "mac-editors"
  }
edges:
  - kind: imports
    to: 01a1555c-b587-793c-ac98-7a6fabf5a0b8
sources:
  - kind: dir
    ref: apps/tagma/server/src/mac-editors
---
Fills the editors module's `EditorHost` port on macOS: one `osascript` process asks LaunchServices for the bundle id of every catalog entry at once and draws each found application's icon at 32 px; the icon is remembered by application path and not drawn twice. The entry's command becomes the CLI inside the bundle when there is one, and a catalog entry without a CLI opens through `open -na`; a link is opened with `open`.
