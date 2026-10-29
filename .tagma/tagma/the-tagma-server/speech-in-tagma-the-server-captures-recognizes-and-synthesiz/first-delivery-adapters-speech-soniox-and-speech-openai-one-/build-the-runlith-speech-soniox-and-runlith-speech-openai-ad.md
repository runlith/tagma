---
id: 01a1050d-b653-758c-bca6-8842517daa38
title: Build the `@runlith/speech-soniox` and `@runlith/speech-openai` adapters
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a105a9-f501-7cad-90b0-98812785a283",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0ff30-3ce0-7879-8c00-c37a9c5ec1b5
  - kind: waits-on
    to: 01a1050d-b653-758c-bca6-883f49f6844e
---
Per spec [[9c5ec1b5]] on top of `@runlith/speech`. Done when `step` on recorded frames and the `ScriptedTransport` tests are green.
