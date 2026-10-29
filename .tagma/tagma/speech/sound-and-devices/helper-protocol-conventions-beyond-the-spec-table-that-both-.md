---
id: 01a105cc-95ab-7e56-aaad-d4e1c89c9715
title: "Helper protocol: conventions beyond the spec table that both sides hold"
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/audio/src/helper/frame.ts
  - kind: file
    ref: packages/audio/src/helper/messages.ts
  - kind: file
    ref: packages/audio/src/helper/session.ts
---
The spec defines the frame and the message table; these are the conventions the table does not name, which both sides must hold the same way.

- **Nanoseconds in JSON are decimal strings** (`nowNs`, `fromNs`, `toNs`). A JSON number loses low bits past 2^53 ns — about 104 days of machine uptime, which a Mac reaches easily. In the audio frame, time is a binary int64; no problem there.
- **Audio frame S→H is `uint32 id` + PCM with no time**; H→S carries an int64 time. Playback has no time.
- **The playback window is 1000 ms** (`playbackWindowMs`): the client never holds more unplayed audio at the helper than one player, and the helper must fit that window plus conversion margin. The window is fixed by the protocol, with no negotiation: a client `queueMs` outside 1..window is a construction error.
- **`played` means "left the queue"**, not "sounded": after `clear` the helper reports discarded audio with the same `played`. Otherwise the client never learns how much credit came back, and `write` stalls forever.
- **`mute`/`unmute` have answers**: `ready{id}` or `refused`, then `end{id, released}`. Without them muting can neither be refused nor can the holder release be known.
- **A `refused` without `id`** — the helper could not parse the client message. The client counts it as `helper-mismatch` of the whole session.
- **`devices` and `output` without `id` are answered in request order**, and the helper never refuses `output`: a device output it could not read is `unknown`. A refusal without `id` would break the session as a mismatch.
- **The helper silently ignores `stop`, `abort`, `release`, `unmute` for an unknown or already finished id.** The client sends them from a finalizer that can race `refused` or `end`. Refusing them would break the session as a mismatch.
- **Any message after `end` or `refused` of its resource is a violation**; the client holds the resource until `end`, so a message for an unknown id is a violation too.
- Decoding is strict: an extra field is the same violation as an unknown `type`.
- **After `release` the client sends no audio, `mark`, or `clear` under that id**: closing the player and admitting frames share one admission queue, so the helper may refuse them.
- **A failed write into the channel ends the whole session.** Whether the frame was accepted is unknown, and credit and marks can no longer be kept honestly under an unknown frame.
