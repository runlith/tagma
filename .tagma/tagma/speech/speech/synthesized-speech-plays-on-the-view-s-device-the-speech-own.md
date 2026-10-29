---
id: 01a123c4-59f2-7742-abe2-57993c3fd3e3
title: "Synthesized speech plays on the view's device: the speech owner hands audio to the client, the client plays it locally"
ord: 25
tags: ["task"]
fields:
  {
    "holder": "tagma:01a123b1-e4f9-7e27-8532-972bdf861a7e",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a123b1-a094-72bd-b4ab-f762e0d0c77f
  - kind: implements
    to: 01a1227f-7522-78e3-a658-79b7a0a16218
sources:
  - kind: file
    ref: apps/tagma/server/src/speech/speaking.test.ts
---
The `tagma/speech` bridge ([[e0d0c77f]], `528c6996e8`) voices text with the existing `speak_text` on the server machine: a view opened in a browser or on a phone hears no sound — the spec's language-trainer scenario on a remote device does not work. The speech owner lacks a contract: synthesis hands audio to the calling client, and the client plays it locally; `speak_text` on the server machine stays for its own consumers. Done when `speak` from a plugin view on the web plays in that view's browser (owner test for audio output and client playback test), and `silence` stops it. Landed in `5571519259`: `speech.synthesize`, local `Playback`, a separate scoped channel for the paced stream, and voice removal on `silence`/teardown. Server and app typecheck and 21 targeted tests passed; the single-round Sol xhigh finding about blocking the shared RPC reader was fixed at the transport owner. Live check of own `tagma:try` on port 57480: the view inside an opaque iframe received real Soniox `tts-rt-v2`/Maya, the browser played 61,440 PCM samples with nonzero energy in 30 Web Audio buffers and answered `spoken`; `silence` cut the next long phrase and closed the AudioContext. The key moved with the operator's permission was deleted from the trial instance; the instance and tab were stopped. Safari/iPhone and desktop Electron were not checked separately.
