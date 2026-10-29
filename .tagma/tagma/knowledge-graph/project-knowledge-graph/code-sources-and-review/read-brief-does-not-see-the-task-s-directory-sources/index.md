---
id: 01a13c16-d5fb-7fde-a555-9b8a05feb760
title: read_brief does not see the task's directory sources
ord: 10
tags: ["reflection"]
fields:
  {
    "actual": "The answer ends with \"The task names no code: anchor it where the work lands\", though read_zone(ac55a302) lists both source[dir] and read_owners on them finds the task. The owners took two manual read_owners and a read_block.",
    "command": "read_brief({project:\"runlith\", scopeId:\"ac55a302\"})",
    "expected": "The task brief reads its directory sources and delivers the owners of apps/tagma/server/src/mcp and packages/mcp."
  }
---
Filed from project `runlith`.
