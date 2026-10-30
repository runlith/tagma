---
id: 01a18e1d-2841-72f0-b3c5-26c3d4a5b244
title: Built-in Google adapter
ord: 41
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/adapter.ts"
      },
      {
        "at": "src/harness/gemini.ts"
      },
      {
        "at": "src/icon.ts"
      }
    ],
    "id": "@runlith/adapter-google"
  }
edges:
  - kind: imports
    to: 01a12c51-8120-7250-9703-61feea5c74f4
sources:
  - kind: dir
    ref: packages/adapter-google
---
Google's Gemini CLI is offered as a Tagma thread through this adapter's terminal surface and hook codec. The CLI owns its conversation; Tagma's harness drivers launch it and consume its declared observations.