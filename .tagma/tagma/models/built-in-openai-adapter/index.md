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
        "at": "src/icon.ts"
      },
      {
        "at": "src/harness/codex.ts"
      },
      {
        "at": "src/harness/session.ts"
      },
      {
        "at": "src/testing/",
        "role": "testing"
      },
      {
        "at": "src/oauth/vendors/openai.ts"
      }
    ],
    "id": "@runlith/adapter-openai"
  }
edges:
  - kind: imports
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: imports
    to: 01a0c944-8aa1-7e16-b225-ddc5d1caad35
  - kind: imports
    to: 01a12c51-8120-7250-9703-61feea5c74f4
  - kind: imports-tests
    to: 01a13b4d-7a3d-7729-955f-a344b43ff1ba
  - kind: imports-tests
    to: 01a16b71-3a1f-7cfb-a633-2283feef9784
sources:
  - kind: dir
    ref: packages/adapter-openai
---
OpenAI provider declarations and the Codex CLI binding live together so the provider package supplies its accounts, model routes and harness behavior. Wire requests come from `@runlith/llm`; the server supplies the terminal driver and the app-server exchange used to prepare roots and cuts.