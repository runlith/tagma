---
id: 01a12c56-911d-7f8b-ade2-75bbc432f43a
title: Built-in OpenAI adapter
ord: 26
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/adapter.ts"
      },
      {
        "at": "src/models/"
      },
      {
        "at": "src/profiles/"
      },
      {
        "at": "src/oauth/"
      },
      {
        "at": "src/icon.ts"
      }
    ],
    "id": "@runlith/adapter-openai"
  }
edges:
  - kind: imports
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: imports
    to: 01a12c51-8120-7250-9703-61feea5c74f4
  - kind: imports-tests
    to: 01a13b4d-7a3d-7729-955f-a344b43ff1ba
sources:
  - kind: dir
    ref: packages/adapter-openai
---
OpenAI provider declarations in the Tagma registry: subscription (`openai-oauth`), API key (`openai`), and Codex as an external harness (`codex`) with the `CODEX_HOME` account directory. Request registrations come from `@runlith/llm`.
