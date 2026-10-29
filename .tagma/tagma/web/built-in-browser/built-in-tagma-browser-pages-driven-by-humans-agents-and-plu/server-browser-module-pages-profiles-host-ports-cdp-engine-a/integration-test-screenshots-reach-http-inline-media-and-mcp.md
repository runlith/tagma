---
id: 01a14a77-03bd-7244-8ec9-334e340b3f85
title: "Integration test: screenshots reach HTTP inline media and MCP image content"
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18445-77e6-757c-9466-a41c45e54ab1",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1484a-2e3b-77ca-b058-0914c4428b2f
sources:
  - kind: file
    ref: apps/tagma/server/src/cli/verbs/mcpServe.ts
  - kind: file
    ref: apps/tagma/server/src/composition/http/operations.ts
---
Cover delivery of a `capture_page` screenshot through the HTTP door (`tagma-media: inline` → `_meta.media`) and the real stdio MCP bridge (`image` content), with one file-scoped managed host attached to the shared terminal world. An integration test (`*.itest.ts`) with a managed host on Chrome for Testing and the HTTP door is needed. Check the public result: with the header the answer carries `_meta.media` with a viewport-size PNG; without it — only the file path; the MCP bridge returns `image` content and never repeats base64 in text and `structuredContent`. Assert on the public answer, not on internal options.
