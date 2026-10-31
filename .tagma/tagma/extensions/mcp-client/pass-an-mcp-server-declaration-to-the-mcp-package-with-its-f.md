---
id: 01a0ca5d-3c58-75a2-9b80-116283a53ae4
title: "Pass an MCP server declaration to the MCP package with its final values: the package substitutes nothing"
ord: 14
tags: ["rule"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/mcp/declarations.ts
    symbol: readied
  - kind: symbol
    ref: packages/mcp/src/McpServerDeclaration.ts
    symbol: McpServerDeclaration
---
Tagma resolves `${NAME}` only in user and project declarations. A contributed declaration arrives final from its contributor, and a `${…}` left in it goes to the server literally: resolving it would hand an operator's value to a host the contributor chose.