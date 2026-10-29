---
id: 01a106d0-8cf8-7612-9139-ad2cc4616251
title: macOS sound
ord: 29
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/channel.ts"
      },
      {
        "at": "src/capabilities.ts"
      }
    ],
    "id": "@runlith/audio-darwin",
    "kind": "kit"
  }
edges:
  - kind: imports
    to: 01a105cc-6070-7b19-9ced-29e5e38a1975
  - kind: imports-tests
    to: 01a13b4d-7a3d-7729-955f-a344b43ff1ba
sources:
  - kind: dir
    ref: packages/audio-darwin
---
macOS gives the server microphone, system sound and playback through a separate helper app inside the host bundle. The package owns CoreAudio/VPIO, realtime rings and native resource lifetimes; the TS layer opens the helper via LaunchServices and hands the channel to the shared `@runlith/audio` client. The app name, bundle id, install location and platform service implementations are set by the host.
