---
id: 01a14c08-619e-7ae1-af8b-16c45619ee9c
title: Top-bar capture chip shows everything Tagma is listening to and stops it with one button
ord: 5
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c08-619e-7ae1-af8b-16c009901e65
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/speech/CaptureChip.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/speech/Captures.svelte.ts
  - kind: file
    ref: apps/tagma/server/src/speech/listening/captures.ts
  - kind: symbol
    ref: apps/tagma/server/src/speech/contract/wire/feeds.ts
    symbol: CAPTURES_FEED
---
**Value.** The operator always sees what Tagma is listening to right now — dictation, a check, or a capture another module keeps — and stops it all with one press.

**How.** A chip in the window's top bar with a timer, sources (microphone, system audio), capture count, and a Stop button; underneath it the `speech.captures.subscribe` feed, available only to the operator.

**Behaviour.**
- The feed carries every open capture on the machine: recognitions without recording and the captures a module keeps. It is fed by the same registry that opens and closes captures, with no polling.
- Hovering tells how many captures are open, what is heard and where: on the server machine, on the paired device, or both.
- Stop ends a kept capture through its module's own stop and a recognition by reading out the tail.

**Limits.** This is state display, not a permission request. The chip carries no paired-device name.
