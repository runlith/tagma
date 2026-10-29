---
id: 01a15509-b0a7-7bec-b352-474ed3b1f567
title: "Step-description producers: message kind, protocol in details, models by name, no own cut and opens"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a154fa-d3bc-7a25-8e12-350dc1e6c60b",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15505-e84f-704a-8ac7-db7516b0175d
---
Per [[16b0175d]]: `tool/display.ts` gets the `message` kind; producers (`agent/collaboration`, `agent-tools` bash/grep/glob/webfetch, `mcp/mcpToolCatalog.ts`, server `voice/graphDisplay.ts`, `voice/sessionDisplay.ts`) put the outcome in `facts`, protocol in `details`, whole text, model names from the catalog. Proof is package typecheck and passing tests.
