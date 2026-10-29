---
id: 01a12c46-ab9c-7595-ace5-ac3c51d6a7bf
title: Built-in providers are adapter packages with module cards; anthropic, openai, xai, deepseek keys assembled
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12c47-00db-7c9c-bac5-59ed12329bd1",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a12c24-69a2-7f74-a6cf-a29052b10a62
  - kind: waits-on
    to: 01a12c46-ab9c-7595-ace5-ac3a7fa6848f
---
The "Delivery and installation" (built-ins) and "What changes in other nodes" sections of the spec [[52b10a62]]. Vendor profiles from `packages/llm/src/profiles` and `models/*` become standalone packages on the contract; shared model descriptions come through one adapter depending on another; one `#module` card per package, and the `@runlith/llm` card ([[249ce587]]) narrows. Registrations keyed `anthropic`, `openai`, `xai`, `deepseek` connect. Done: the server assembles from packages, key providers answer, the module gate is clean.
