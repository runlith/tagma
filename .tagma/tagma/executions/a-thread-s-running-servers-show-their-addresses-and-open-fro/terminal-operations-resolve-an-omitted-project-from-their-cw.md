---
id: 01a19420-c804-7a59-90ff-b37de0269153
title: Terminal operations resolve an omitted project from their cwd, so a terminal lands in the project and root of its checkout
ord: 2
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: implements
    to: 01a19420-92b3-74b1-b0e9-37b06636131b
  - kind: relates
    to: 01a19414-3450-7586-b2b1-a1510f6f108c
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/terminals/start.ts
---
A thread homed in tagma started dev servers with `cwd` in runlith's checkout: they were recorded in tagma with no `rootId`, so no surface can open them. `projectField` promises an omitted project resolves from a path the call names; `start_terminal`'s `cwd` is such a path. Adjacent to reflection 0f6f108c (read_terminals refuses `project`).