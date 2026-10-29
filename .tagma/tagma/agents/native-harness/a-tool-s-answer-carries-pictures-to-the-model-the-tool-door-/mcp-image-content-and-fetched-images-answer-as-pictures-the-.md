---
id: 01a0db92-3af4-70c8-9fa5-585c6a8bbf12
title: MCP image content and fetched images answer as pictures the model sees
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0db83-ef63-7ba3-8928-1f42ad36ec89",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0db91-a95d-7cbe-b90b-800107b62a24
  - kind: waits-on
    to: 01a0db92-3b40-7b46-be6f-1e4042e35b15
---
Build §4.8–§4.9 of [[07b62a24|the decision]] on the `media` answer the first task lands: `mcpAnswer` in `packages/mcp/src/mcpToolCatalog.ts` turns MCP `image` content into `media` (audio and resources stay named by kind), and `webfetch` answers an image response as `media` labelled by its URL.

Done when an MCP answer holding an `image` block and a webfetch of an image URL each reach the model as an image part, and [[1836c85a]] and [[bd350355]] are reconciled from the code.
