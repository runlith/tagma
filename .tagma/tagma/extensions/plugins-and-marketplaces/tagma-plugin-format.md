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
      },
      {
        "at": "list.ts"
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
  - kind: imports
    to: 01a18921-850b-74c0-a119-c016a939df5d
  - kind: imports
    to: 01a189a0-4b54-758e-bef7-1061d6fd5286
sources:
  - kind: dir
    ref: apps/tagma/server/src/plugin-formats/tagma
---
A plugin written in Tagma's own format is read from the `tagma-plugin.json` its directory holds: its id, title, options with the secret ones among them, the process that serves its tools over stdio MCP, the MCP servers it brings (`mcpServers`, read with the Agent Plugins format's server reader, so both formats hold a server entry to the same checks and `${PLUGIN_ROOT}`/`${PLUGIN_DATA}` expansion), and its contributions by point. The adapter turns that manifest into the one plugin description the plugins module installs and enables; what each point means stays with the point's owner, and the host runs the process.