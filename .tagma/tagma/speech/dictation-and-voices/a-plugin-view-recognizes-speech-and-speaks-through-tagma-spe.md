---
id: 01a14c08-619e-7ae1-af8b-16d6968ea9d7
title: A plugin view recognizes speech and speaks through Tagma speech
ord: 11
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc0-7704-77d5-b31a-ec5a94567243
  - kind: relates
    to: 01a14c08-619e-7ae1-af8b-16c2407890be
  - kind: relates
    to: 01a14c08-619e-7ae1-af8b-16c8362f480f
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/speech/Playback.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/speech/viewSpeech.ts
  - kind: file
    ref: apps/tagma/server/src/speech/contract/wire/view.ts
---
**Value.** A plugin view builds its own voice interface — dictation and speech output — on Tagma speech, with no keys, models or microphone access of its own.

**How.** The `tagma/speech` method of the plugin-view bridge with actions: status, recognition, tail read-out, unsubscribe, speak and silence; its events arrive as `tagma/notifications/speech` notifications.

**Behaviour.**
- Recognition records audio where ordinary dictation does: on the server machine — the server, on a paired device — the device itself.
- Speech output plays on the device showing the view, through Web Audio, not through the server speakers; the answer arrives after playback ends. Silence, a new phrase and closing the view cancel only that view's speech output.
- Losing or regaining the connection drops subscriptions and capture; they do not reopen on their own.

**Limits.** Only plugin views; someone else's MCP App does not get this method.