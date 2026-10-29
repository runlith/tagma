---
id: 01a172fb-350e-7755-a371-b634031dade6
title: Check opening of release_block and close_block by exact tool names
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a172fa-4015-7c32-b44c-9d2d14e756f9",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16e6e-d660-7bed-a1a5-1f9a8cc0e2ef
---
The catalog bug is not confirmed: the [[01a16dec-fbf8-7898-a8a7-e83233ac9f35|source thread]] got `close_block` and `release_block` without a prefix in context #3; in #3700 and #4780 it requested `select:mcp__tagma__close_block` and `select:mcp__tagma__release_block` and got `missing` for exactly those names. `AgentDeferredTools.selected` looks up the exact name; operations are declared without a prefix in `graph/contract/wire/operations/work.ts`. A current public request for both variants opened `release_block` and `close_block`, and returned prefixed names in `missing`. There is no data on where the agent took the prefix from; the source session never checked the plain names. The code did not change.
