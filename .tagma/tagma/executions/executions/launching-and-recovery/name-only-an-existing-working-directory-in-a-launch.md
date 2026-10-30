---
id: 01a0c703-a2c9-7265-a287-dc6bd34623ae
title: Name only an existing working directory in a launch
ord: 2
tags: ["rule"]
sources:
  - kind: file
    ref: packages/executions/src/protocol/launch.ts
  - kind: symbol
    ref: packages/executions/src/protocol/launch.ts
    symbol: LaunchCommand
---
The caller assembling the command provides the directory; launch does not create it.