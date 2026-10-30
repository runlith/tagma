---
id: 01a0ca5d-3c56-764c-ba46-438ddb23eb3a
title: A served MCP tool's `call` answers a tool failure as a result with `isError`, never by throwing
ord: 13
tags: ["rule"]
sources:
  - kind: dir
    ref: packages/mcp
  - kind: symbol
    ref: packages/mcp/src/sdkServer.ts
    symbol: McpServerInput
---
An exception from `call` means a transport fault.