---
id: 01a18993-811d-7dd2-af22-f3dd4210622f
title: Codex plugin format
ord: 52
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "format.ts"
      }
    ],
    "id": "codex-format"
  }
edges:
  - kind: imports
    to: 01a18921-8504-7058-9d53-62c5e9aa47fc
  - kind: imports
    to: 01a18921-850b-74c0-a119-c016a939df5d
sources:
  - kind: dir
    ref: apps/tagma/server/src/plugin-formats/codex
---
Tagma reads a Codex plugin as OpenAI's packaging definition says: a legacy `.codex-plugin/plugin.json` directory, or a portable Agent Plugins root manifest whose `extensions["com.openai"]` overlay replaces the legacy manifest as the source of OpenAI settings. It reads skills, the `.mcp.json` servers, `interface` as display data and command hooks, which run through the hook runner the plugins module owns under Codex's tool names, environment and timeouts; `.app.json`, `apps` and `onboardingSkill` are listed as ignored. The portable root case composes with the Agent Plugins format's portable reader and declares nothing about other formats.