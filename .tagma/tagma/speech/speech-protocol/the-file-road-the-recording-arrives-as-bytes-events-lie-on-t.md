---
id: 01a13818-1459-7d90-bf1c-87f1b249d60e
title: "The file road: the recording arrives as bytes, events lie on the file's scale as one segment, and the `Job` key leaves for the caller ahead of the results"
ord: 9
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/speech/src/engine/transcription.ts
  - kind: file
    ref: packages/speech/src/protocol/adapter.ts
---
The kit knows no filesystem: the recording (`Recorded`) arrives as a byte stream with MIME, size, format and duration, and the caller decides whether to hand the file as-is or decoded — by the model's `containers`. Adapter events are the same `SpeechEvent`, time is the recording format's frames from the file's start, so `Speech.transcribe` utterances lie on the file's scale.

- **One segment.** A single `Assembler` in `none` mode gathers all the file's events (speaker change, pause, length); the last `Finished` closes open utterances. An event stream that ended without `Finished` is a `transport` failure: it cannot tell a complete answer from a cut one.
- **`Job`.** An adapter that runs the work on its side gives the key in a `Job` event ahead of the results, and the service passes it to the caller: only so can the key be saved before the work runs to its end. Such an adapter must provide both `resume` (the same events by key) and `discard` (cleanup at the vendor) — the catalog refuses an adapter with only one of the two. An adapter answering the request at once sends no `Job`.
- **`Speech.resume`** takes the recording format explicitly: after a restart the recording is not at hand, yet event frames convert to milliseconds at its rate.
