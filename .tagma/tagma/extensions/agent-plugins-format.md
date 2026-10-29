---
id: 01a18921-850b-74c0-a119-c016a939df5d
title: Agent Plugins format
ord: 49
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "format.ts"
      },
      {
        "at": "portable.ts",
        "for": [
          "4210622f"
        ]
      }
    ],
    "id": "agent-plugins-format"
  }
edges:
  - kind: imports
    to: 01a18921-8504-7058-9d53-62c5e9aa47fc
sources:
  - kind: dir
    ref: apps/tagma/server/src/plugin-formats/agent-plugins
---
Tagma reads an Agent Plugins 1.0 package as that standard says: the closed root `plugin.json` whose `$schema` names the 1.0 schema, `skills/` and `mcp.json` with `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` expanded in args, env and cwd only. Unknown manifest fields are reported and ignored, any other violation rejects the package, and an invalid server entry is skipped with its reason. Its `portable.ts` entry, open to the Codex format alone, reads a root package and hands back the package with its raw `extensions`, so a format that owns a vendor extension composes with it instead of re-reading `mcp.json`.