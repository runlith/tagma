---
id: 01a18e9b-c4a9-7c9a-8d63-960d1488321a
title: Keep the OpenCode terminal plugin conformance inside its adapter
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18e90-ac9d-7548-8cab-9f3a51c4dec2",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a18cbf-97fc-7f17-bc60-685157787448
---
Move the real terminal plugin conformance from server tests to the adapter, supplying its declared assets and fixture hook/MCP configuration without server installers. Close the private host and environment package doors once no server consumer needs them; server installation behavior remains covered at its owner.