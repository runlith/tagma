---
id: 01a1555c-b58d-7103-81e9-3352a631c455
title: PATH editors
ord: 15
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "."
      }
    ],
    "id": "path-editors"
  }
edges:
  - kind: imports
    to: 01a1555c-b587-793c-ac98-7a6fabf5a0b8
sources:
  - kind: dir
    ref: apps/tagma/server/src/path-editors
---
Fills the editors module's `EditorHost` port where applications do not register by bundle id: finds the catalog entries' commands in the server PATH and in the directories the composition named (JetBrains Toolbox scripts), gives no icons; a link is opened by the program the composition named.
