---
id: 01a1adb5-4e03-7f9b-b329-e56dc7b772e2
title: Tagma plugin format
ord: 29
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "format.ts"
      },
      {
        "at": "testing/",
        "role": "testing"
      },
      {
        "at": "contract/"
      }
    ],
    "id": "tagma-plugin-format",
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
    to: 01a18921-8504-7058-9d53-62c5e9aa47fc
sources:
  - kind: dir
    ref: apps/tagma/server/src/plugin-formats/tagma
---
A plugin written in Tagma's own format is read from the `tagma-plugin.json` its directory holds: its id, title, options with the secret ones among them, the process that serves its tools over stdio MCP, and its contributions by point. The adapter turns that manifest into the one plugin description the plugins module installs and enables; what each point means stays with the point's owner, and the host runs the process.