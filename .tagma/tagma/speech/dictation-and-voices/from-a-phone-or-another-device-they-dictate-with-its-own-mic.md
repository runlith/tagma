---
id: 01a14c08-619e-7ae1-af8b-16c2407890be
title: "From a phone or another device they dictate with its own microphone: the device writes sound, the server recognizes"
ord: 3
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc0-76d6-793a-939b-838f9b8c75ed
  - kind: relates
    to: 01a14bc0-76f5-7c7d-bd06-8e7f03fd84a3
  - kind: relates
    to: 01a14c08-619e-7ae1-af8b-16c009901e65
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/speech/dictation/Sender.ts
  - kind: file
    ref: apps/tagma/server/src/composition/http/sending.ts
  - kind: file
    ref: apps/tagma/server/src/speech/listening/sending.ts
  - kind: file
    ref: packages/audio/src/sound/track.ts
---
**Value.** The operator dictates from a phone or laptop on another network into the agent field with their microphone. The Mac microphone does not switch on.

**How.** The same microphone button in the agent field as on desktop. Which side writes sound the server decides by connection: a bound device's call gets "the caller writes" from `speech_status`. The device writes sound itself and sends it over a separate binary WebSocket, and the server recognizes with the same recognizer, keys, and rules as plain dictation.

**Behaviour.**
- The decision is made by the connection, not screen width: a laptop browser through the remote door also writes at itself. Unloaded status — dictation refuses instead of switching the Mac microphone on at random.
- Sound time is counted by frame numbers, so network jitter births no gaps; lost frames become a break in the text. Dictation with loss inserts what was heard but does not send it.
- A browser that refused the microphone, a context without HTTPS, or a busy microphone gives a reason and a path to fix.
- The Mac recording chip says recording goes on the bound device. Revoking the device also closes its sound stream.

**Limits.** Dictation only: listenings and calls are not written from a device, and voicing on a device (`speak_text`) does not play. Collapsing a PWA on iOS or blanking the screen ends dictation with loss: background recording is impossible. Sound goes as uncompressed PCM.
