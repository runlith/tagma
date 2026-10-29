---
id: 01a0ca5d-3c56-764c-ba46-438ddb23eb3a
title: Answer a served failure inside its result — never throw from call
ord: 13
tags: ["rule"]
sources:
  - kind: dir
    ref: packages/mcp
  - kind: symbol
    ref: packages/mcp/src/sdkServer.ts
    symbol: McpServerInput
---
The failure carries a result with isError; an exception from call means a transport fault.
