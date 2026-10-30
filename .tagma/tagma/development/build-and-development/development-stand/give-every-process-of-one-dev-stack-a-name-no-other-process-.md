---
id: 01a0c83c-e1d1-72d3-9243-c4b57cf4c5e5
title: Give every process of one dev stack a name no other process of the stack has
ord: 6
tags: ["rule"]
sources:
  - kind: file
    ref: packages/dev-runner/src/index.ts
---
The runner keys its standing processes by name; a duplicate overwrites the earlier entry and a restart then stops the wrong process.