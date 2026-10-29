---
id: 01a106de-b389-78fb-850a-db7a37cf95e6
title: Soniox speech adapter
ord: 32
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/provider.ts"
      }
    ],
    "id": "@runlith/speech-soniox",
    "kind": "kit",
    "order": [
      [
        "src/credential.ts",
        "src/models.ts",
        "src/frames.ts"
      ],
      [
        "src/recognition.ts",
        "src/synthesis.ts",
        "src/transcription.ts"
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
    ref: packages/speech-soniox
---
Soniox joins the speech protocol with one provider value: streaming recognition with `<end>` turns, translation and speakers, whole recorded-file recognition (`stt-async-v5` over HTTP) and streaming synthesis. The adapter owns the vendor wire — the init message, tokens, the error map and model capabilities — and provides the streaming path as a pure `step` automaton over frames; the socket, the queue until readiness and `Finished` are managed by the core's duplex executor, while file work — upload, polling, result and vendor cleanup — the adapter runs itself through `HttpClient`.
