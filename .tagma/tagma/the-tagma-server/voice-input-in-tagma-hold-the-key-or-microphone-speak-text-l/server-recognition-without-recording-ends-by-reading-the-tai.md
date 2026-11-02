---
id: 01a10b71-faaa-7731-9455-7d9e0d2967d5
title: "Server: recognition without recording ends by reading the tail via `finish_recognition`, and dictation has its own recognizer key"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a10b72-5c71-7a83-a327-0447125159c0",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a10b70-624a-788b-ba2a-cbe616b50a26
sources:
  - kind: dir
    ref: apps/tagma/server/src/speech
---
The "Server" section of spec step 1: `id` in the `speech.recognize` feed ask, the `finish_recognition` operation, the `unknown-recognition` refusal, the `speech.dictation.recognizer` key. Start with `apps/tagma/server/src/speech/listening/hearing.ts`. Done when an itest proves: `finish` returns the confirmed tail to the feed's end, unsubscribing does not wait for the tail, an unknown id refuses.
