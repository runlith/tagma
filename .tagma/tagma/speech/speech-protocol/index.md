---
id: 01a106db-b8b2-7b23-bc99-c3d1eaabfb41
title: Speech protocol
ord: 30
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/wire/"
      },
      {
        "at": "src/protocol/"
      },
      {
        "at": "src/engine/"
      },
      {
        "at": "src/transport/"
      },
      {
        "at": "src/testing/",
        "role": "testing"
      }
    ],
    "id": "@runlith/speech",
    "kind": "kit",
    "order": [
      [
        "src/wire/"
      ],
      [
        "src/protocol/"
      ],
      [
        "src/engine/",
        "src/transport/"
      ],
      [
        "src/testing/"
      ]
    ]
  }
edges:
  - kind: imports
    to: 01a105cc-6070-7b19-9ced-29e5e38a1975
sources:
  - kind: dir
    ref: packages/speech
---
Tagma speech reaches any provider through this kit: it provides a neutral language of requests and events, model capabilities as data, a catalog with capability-based choice, an adapter contract with a pure `SpeechProtocol` and a shared duplex runner, while recognition sessions (segments, timeline, utterances, `Segmenter`), the recorded-file path in which the model hears the whole file, and synthesis assemble into the `Speech` service. The kit names no vendor and depends on no runtime: it gets its providers, networking, credentials and the speech detector through the `SpeechSources`, `DuplexTransport`, `SpeechCredentials` and `SpeechDetector` ports, which the host's composition fills; each change of the sources rebuilds the catalog, so a provider a plugin brings joins without a restart. The only `DuplexTransport` implementation over WebSocket — `transport/websocket` — lives in the kit itself: the header-carrying socket constructor is given by composition (Bun — the global `WebSocket`, Electron main — `ws`); vendor adapters, the Whisper engine and device audio belong to other packages.
