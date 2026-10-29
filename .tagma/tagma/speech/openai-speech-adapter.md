---
id: 01a106de-b394-7128-a2fc-7b9126b6da83
title: OpenAI speech adapter
ord: 33
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/provider.ts"
      }
    ],
    "id": "@runlith/speech-openai",
    "kind": "kit",
    "order": [
      [
        "src/credential.ts",
        "src/models.ts",
        "src/frames.ts"
      ],
      [
        "src/recognition.ts",
        "src/synthesis.ts"
      ],
      [
        "src/provider.ts"
      ]
    ]
  }
edges:
  - kind: imports
    to: 01a106db-b8b2-7b23-bc99-c3d1eaabfb41
  - kind: imports-tests
    to: 01a13b4d-7a3d-7729-955f-a344b43ff1ba
sources:
  - kind: dir
    ref: packages/speech-openai
---
OpenAI connects to the speech protocol as a single provider value: a realtime recognition session (a turn is an `item_id`; `server_vad` and `client` modes; `gpt-live-transcribe` only with a client turn end) and synthesis through `/audio/speech` with full text. The adapter owns the vendor wire, the error map, and model capabilities; the core duplex runner owns the socket and `Finished`, and the synthesis HTTP request goes through `HttpClient`, which the host composition binds.
