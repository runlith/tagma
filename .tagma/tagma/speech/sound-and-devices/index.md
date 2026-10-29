---
id: 01a105cc-6070-7b19-9ced-29e5e38a1975
title: Sound and devices
ord: 28
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/sound/"
      },
      {
        "at": "src/port/",
        "role": "port"
      },
      {
        "at": "src/helper/"
      },
      {
        "at": "src/testing/",
        "role": "testing"
      },
      {
        "at": "src/conformance/",
        "role": "testing"
      }
    ],
    "id": "@runlith/audio",
    "order": [
      [
        "src/sound/"
      ],
      [
        "src/port/"
      ],
      [
        "src/helper/"
      ],
      [
        "src/testing/",
        "src/conformance/"
      ]
    ]
  }
edges:
  - kind: imports-tests
    to: 01a13b4d-7a3d-7729-955f-a344b43ff1ba
sources:
  - kind: dir
    ref: packages/audio
---
Tagma speech gets audio through this kit: it defines what a PCM chunk with capture time in the process monotonic clock is, an explicit gap, and a track that ends with a reason, and takes device audio in and out through the `AudioDevices` port. The package owns the streaming polyphase resampler, the level meter, the neutral native-helper protocol, and the TS client over the channel implementing the port for any OS. The platform package launches the helper and provides the channel itself, host composition picks the implementation, and listenings — their timeline and recognition — belong to consumers.
