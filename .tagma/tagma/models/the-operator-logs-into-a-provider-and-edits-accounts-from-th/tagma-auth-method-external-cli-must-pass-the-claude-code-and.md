---
id: 01a14c37-8e0f-7c77-a560-645dea882a4d
title: tagma auth --method external-cli must pass the Claude Code and Codex login
ord: 1
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a14c08-22b6-75de-88f8-5c0082a1e659
---
The flag exists, but the Claude Code and Codex login requires a project, which the CLI does not pass — the server refuses `project-required`. Along the way, the `tagma auth` description ("via subscription OAuth") does not name the API keys the command accepts.
