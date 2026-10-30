---
id: 01a18d5f-315e-7cf6-89b8-16def116d3cd
title: "First vendor package: Grok or Gemini moves out of the server with its terminal surface, hook codec and metadata reader"
ord: 2
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: implements
    to: 01a18cbf-97fc-7f17-bc60-685157787448
  - kind: waits-on
    to: 01a18d5f-1e10-7fda-99bc-25fc9ee84806
---
Step 4 of the Migration in [[57787448]]: the smallest terminal-only vendor proves the contract. Its server code is deleted, its tests move into the package and stay green, behaviour and ids are unchanged. The spec's acceptance 2 (a test package with a codec no builtin vendor has, installed by `install_adapter`) lands here.