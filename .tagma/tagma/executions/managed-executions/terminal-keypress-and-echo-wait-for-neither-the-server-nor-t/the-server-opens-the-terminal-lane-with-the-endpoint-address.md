---
id: 01a17aff-0013-783e-93b0-82187374bf6c
title: The server opens the terminal lane with the endpoint address and tracks writers and the grid from the host's admitted-input reports
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17ae0-48f6-7cff-9adb-353003be8a0d",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a17aff-0013-783e-93b0-8215dc3c916a
  - kind: waits-on
    to: 01a17aff-0013-783e-93b0-8217d7e0445d
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/terminals/channel.ts
  - kind: file
    ref: apps/tagma/server/src/executions/terminals/lanes.ts
---
Opening a lane after the permission check registers it in the host terminal stream and hands the window the endpoint address and secret. `TerminalWriters` and `InputWitness` feed on the host's asynchronous admitted-input reports. `terminal.input.write` for the window and the `executions/terminal-input-turn` queue go away.
