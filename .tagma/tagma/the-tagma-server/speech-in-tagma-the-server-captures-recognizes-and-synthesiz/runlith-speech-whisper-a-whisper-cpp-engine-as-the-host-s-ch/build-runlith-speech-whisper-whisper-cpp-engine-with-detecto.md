---
id: 01a1050d-b653-758c-bca6-884187dbf690
title: "Build `@runlith/speech-whisper`: whisper.cpp engine with detector streams, process host, model store"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1050e-6092-729e-be54-9de07e7b6e7b",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a104f7-f8d1-7ff5-ad08-d25dba0fa36e
  - kind: waits-on
    to: 01a1050d-b653-758c-bca6-883f49f6844e
---
New `packages/speech-whisper` package per spec [[ba0fa36e]]; the native part moves over from `packages/transcription-whisper/native`. Done when the host and store integration tests and the native smoke are green.
