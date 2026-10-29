---
id: 01a14863-b077-72ab-b6a0-485a8e1fddab
title: "HTTP serves an operation's pictures only under the `tagma-media: inline` header, in `_meta.media`; the MCP bridge lifts them into `image` content"
ord: 6
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/cli/verbs/mcpServe.ts
  - kind: file
    ref: apps/tagma/server/src/composition/http/operations.ts
  - kind: symbol
    ref: apps/tagma/server/src/invocation/perform.ts
    symbol: performMediaByIdIn
---
The operation response's `media` (a `capture_page` screenshot) lands in the native door's `ToolAnswer`. The HTTP door counts it in the same operation context (`performMediaByIdIn`) only when the caller sent `tagma-media: inline`, and puts the base64 into the response's `_meta.media`; without the header, plugins and `tagma op` get a file path and pay nothing for reading and encoding the picture. `tagma mcp serve` always sends the header, lifts `_meta.media` off the text and `structuredContent`, and hands pictures over as `image` content — that is how harness agents see them. The display of the response (`_meta.toolDisplay`) is carried across the bridge into the MCP result's `_meta` under the same key: it is a protocol field for the client, never goes into the model context, and a client that does not know it skips it.
