---
id: 01a12d4a-4b11-7dd5-bbf3-f8fc040c97a8
title: Built-in OpenAI-compatible server adapter
ord: 33
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/adapter.ts"
      }
    ],
    "id": "@runlith/adapter-openai-compatible"
  }
edges:
  - kind: imports
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: imports
    to: 01a12c51-8120-7250-9703-61feea5c74f4
sources:
  - kind: dir
    ref: packages/adapter-openai-compatible
---
The adapter builds providers from the operator's settings: each instance (address, optional key, models with context window) becomes a registry provider on the `openai-compatible-chat` protocol. Ollama, LM Studio, vLLM, and OpenRouter connect with no code; the server's model list is pulled on user action, and only enabled models enter the registry.
