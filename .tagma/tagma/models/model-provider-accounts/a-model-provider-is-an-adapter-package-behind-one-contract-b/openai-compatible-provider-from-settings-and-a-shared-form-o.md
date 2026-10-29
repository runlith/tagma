---
id: 01a12c46-ab9c-7595-ace5-ac3ff4852b8e
title: OpenAI-compatible provider from settings and a shared form on the adapter settings schema
ord: 7
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12d35-b222-7847-bcc5-503db73fa2f4",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a12c24-69a2-7f74-a6cf-a29052b10a62
  - kind: waits-on
    to: 01a12c46-ab9c-7595-ace5-ac3c51d6a7bf
---
Sections "OpenAI-compatible provider from settings" and "An adapter brings no UI" of the spec [[52b10a62]]. The built-in `openai-compatible` adapter, N instances with an immutable id; the window required, the output limit derived from the window, compatibility flags; the list from `/v1/models` by action, only enabled ones into the registry; the adapter settings schema and the shared form on the Providers screen. Done: an instance against a local stub answers with a stream, `max_tokens` within the window; the operator adds Ollama from settings.
