---
id: 01a106dc-1667-7b4e-a536-a43bf12d7847
title: Local Whisper
ord: 31
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/engine/Engine.ts"
      },
      {
        "at": "src/models/catalog.ts"
      },
      {
        "at": "src/models/ModelStore.ts"
      },
      {
        "at": "src/provider.ts"
      },
      {
        "at": "src/detector.ts"
      }
    ],
    "id": "@runlith/speech-whisper",
    "kind": "kit",
    "order": [
      [
        "src/models/",
        "src/engine/",
        "src/testing/",
        "src/artifact.ts"
      ],
      [
        "src/failures.ts"
      ],
      [
        "src/provider.ts",
        "src/detector.ts"
      ]
    ]
  }
edges:
  - kind: imports
    to: 01a106db-b8b2-7b23-bc99-c3d1eaabfb41
  - kind: imports-tests
    to: 01a105cc-6070-7b19-9ced-29e5e38a1975
sources:
  - kind: dir
    ref: packages/speech-whisper
---
Local recognition and the product's only speech detector live in one whisper.cpp engine, which this kit holds as a child process via the host-composed process service. The kit owns the engine (native sources, the stdio protocol, the clip queue, and detector streams), the Whisper model storage, and two fillers of the speech protocol — `SpeechDetector` and the `whisper` batch provider. The host decides the binary, Silero, and model-directory paths, the choice between the provider and `unbuiltProvider` where the engine is not built, and the process and HTTP runtime itself.
