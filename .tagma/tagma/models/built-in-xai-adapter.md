---
id: 01a12c56-911f-76ad-b665-0ff9a95d3d64
title: Built-in xAI adapter
ord: 27
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
        "at": "src/harness/grok.ts"
      }
    ],
    "id": "@runlith/adapter-xai"
  }
edges:
  - kind: imports
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: imports
    to: 01a12c51-8120-7250-9703-61feea5c74f4
sources:
  - kind: dir
    ref: packages/adapter-xai
---
xAI declarations in the Tagma registry: the `xai` API key over `@runlith/llm` registrations, and the Grok Build CLI as the `grok` harness — its terminal surface, its Claude-format hook vocabulary in snake case, and the reader of its session summaries and transcripts.