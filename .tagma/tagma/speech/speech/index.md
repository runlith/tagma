---
id: 01a10731-9758-7fff-9500-8b7243059ef8
title: Speech
ord: 37
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "."
      }
    ],
    "id": "speech",
    "kind": "product",
    "order": [
      [
        "contract/wire/"
      ],
      [
        "."
      ]
    ]
  }
edges:
  - kind: imports
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: imports
    to: 01a0c944-8aa1-7e16-b225-ddc5d1caad35
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a0fd8b-bee9-7760-9b13-b9847a70e34e
  - kind: imports
    to: 01a0fd8b-beeb-7ef2-bff4-d6d3b824564e
  - kind: imports
    to: 01a0fd8b-beed-7934-884b-a443f92da92b
  - kind: imports
    to: 01a0fd8b-beef-70cb-81c5-89e59e75d459
  - kind: imports
    to: 01a0fd8b-bf10-7a02-a086-916b457e7a6c
  - kind: imports
    to: 01a10326-9d9d-7ddf-8111-37bc50467575
  - kind: imports
    to: 01a105cc-6070-7b19-9ced-29e5e38a1975
  - kind: imports
    to: 01a106db-b8b2-7b23-bc99-c3d1eaabfb41
  - kind: imports
    to: 01a1237e-b7b0-70ab-98b0-c0c63d78b068
  - kind: imports
    to: 01a137a5-2cdd-7e99-892d-41b3e3acacf3
  - kind: imports
    to: 01a13b34-f692-7514-aced-482bdbf8f243
sources:
  - kind: dir
    ref: apps/tagma/server/src/speech
---
Tagma hears and speaks on the server machine, and this module is speech as a product: project listenings (capture, recognition, the transcript the agent reads, per-track audio in the recordings directory, and re-recognition of that audio by a model that hears the whole recording), recording-free recognition for the check run and future dictation, synthesis with playback, speech settings, and the answer of what is available here and why. Sessions, the model catalog and synthesis come from the `Speech` service of `@runlith/speech`, audio from the `AudioDevices` port, keys from `providers`; composition binds vendor adapters, the native helper and the Whisper engine. The module does not know the threads in which an agent following a call receives fragments: it declares the `CallThreads` port, and composition fills it with threads.
