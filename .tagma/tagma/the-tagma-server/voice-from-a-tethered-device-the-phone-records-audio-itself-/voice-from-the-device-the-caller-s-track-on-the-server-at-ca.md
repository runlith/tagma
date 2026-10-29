---
id: 01a10dff-9026-7a0c-a911-69b35fd7e5df
title: "Voice from the device: the caller's track on the server (`at: caller`, the `/api/speech/send` channel) and recording in the tethered device's window"
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a10dfe-bb8e-7f48-a7ee-28c462d4cbd1
---
Implement the [[62d4cbd1|spec]] in full: the server (`TrackAsk.at`, `Senders`, the upload channel, `Gap transport`, `Ended sender-lost`, `device` in `Capture`) and the window (the "I am a device" fact, `Sender`, `at: 'caller'` in `Dictation`, browser refusal reasons, a chip with the device name). Done when the spec's server itests pass, the window typechecks, and after Sol + Muse review.
