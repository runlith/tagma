---
id: 01a0ca57-49ce-7537-b08c-64006599d586
title: Agent workspace sources
ord: 24
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/ContextFiles.ts",
        "for": [
          "ab05dfec"
        ]
      },
      {
        "at": "src/SkillDirectories.ts",
        "for": [
          "ab05dfec"
        ]
      },
      {
        "at": "src/WorkflowDirectories.ts",
        "for": [
          "ab05dfec"
        ]
      }
    ],
    "id": "@runlith/agent-sources",
    "kind": "kit"
  }
edges:
  - kind: imports
    to: 01a0c944-8aa1-7e16-b225-ddc5d1caad35
  - kind: imports-tests
    to: 01a13b4d-7a3d-7729-955f-a344b43ff1ba
sources:
  - kind: dir
    ref: packages/agent-sources
---
The agent needs to know what the workspace offers: skills as directories with SKILL.md, saved workflows as JSON documents, and instruction files found by name. The package owns this discovery: every searched directory arrives in the call, and a skill or a workflow that cannot be used comes back with a reason instead of being silently dropped. What is found gives only words: nothing opened here widens what the agent is allowed to do.
