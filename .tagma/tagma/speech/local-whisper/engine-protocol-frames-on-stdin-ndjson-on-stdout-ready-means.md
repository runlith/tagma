---
id: 01a106dc-889b-7cd1-8d09-6b6732af111a
title: "Engine protocol: frames on stdin, NDJSON on stdout, ready means a ready detector"
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/speech-whisper/native/src/main.cpp
  - kind: file
    ref: packages/speech-whisper/src/engine/wire.ts
---
Input is a frame of an 8-byte prefix (JSON header length and payload length, uint32 big-endian), header, and PCM16 little-endian mono 16 kHz; output is one JSON message per line. Both sides check the shape strictly: an unknown field, type, or a payload where none belongs is a `protocol-error`, after which the engine orderly stops its threads and exits.

- `ready{pid, rate, window}` arrives once, when Silero is loaded and probed (one probability per `window` samples); the Whisper model is not needed for readiness.
- A request owed an answer carries `id`; an error with `id` answers it, an error with only `stream` drops that detector stream, an error with neither means the channel is broken, and the host counts the engine as down.
- Detection and recognition run in separate engine threads, so model loading and inference never delay `vad.probs`, and `cancel` is read by the main thread during work.

No version field: the binary and the TS host are built from one checkout.

The log callback is set once at startup: a pinned whisper.cpp reinstalled the ggml global logger on every context init, which from two engine threads is a race; the `native/patches/log-once.patch` patch removes it. The inference thread count is derived from the machine (performance cores on macOS, else half the logical ones); `--threads` sets it explicitly, smoke runs with 3.
