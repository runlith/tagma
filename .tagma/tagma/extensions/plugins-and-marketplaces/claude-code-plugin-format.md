---
id: 01a18921-8509-7ad6-b9a4-fd45d6ac5676
title: Claude Code plugin format
ord: 2
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "format.ts"
      },
      {
        "at": "list.ts"
      }
    ],
    "id": "claude-code-format"
  }
edges:
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a18921-8504-7058-9d53-62c5e9aa47fc
  - kind: imports
    to: 01a189a0-4b54-758e-bef7-1061d6fd5286
sources:
  - kind: dir
    ref: apps/tagma/server/src/plugin-formats/claude-code
---
Tagma reads a Claude Code plugin as that format defines it: `.claude-plugin/plugin.json` or its default layout, skills, commands, agents with that format's tool names mapped to Tagma's, `.mcp.json` servers with its own variables, `userConfig` options and command hooks run by the plugins module's hook runner under this format's tool names, variables and timeouts. It turns the directory into the plugins module's package and declares nothing about other formats.