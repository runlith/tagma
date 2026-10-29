---
id: 01a104f7-f8d1-7ff5-ad08-d25dba0fa36e
title: "`@runlith/speech-whisper`: a whisper.cpp engine as the host's child process — local Whisper and the only speech detector"
ord: 8
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
`@runlith/speech-whisper` holds the whisper.cpp engine as a host child process and provides two things from it: a local `whisper` provider (`kind: batch`, no key) and a `SpeechDetector` — Silero speech probabilities for the core's `Segmenter` ([[d3bd40f5|speech protocol]]). It is the only speech detector in the system: there is no second ML runtime (no ONNX, no energy VAD, no Swift VAD). It replaces `transcription-whisper` and removes `audio-vad`.

## Why the detector lives here

- Local Whisper recognizes a finished fragment; the old driver accumulates the whole session until `finish()` (64 MiB limit, about 35 minutes), so there is no live local recognition without slicing.
- In `client` mode the client finds the end of speech for the models.
- Pinned whisper.cpp (commit `080bbbe`) already contains Silero and a streaming API (`whisper_vad_detect_speech_no_reset`, `whisper_vad_reset_state`, windowed probabilities), while the old sidecar uses Silero only as a “buffer holds speech” check. The extension is small.

## Engine

- **Moving over** from the old sidecar: strict input parsing, cancellation via `abort_callback`, stdio framing (8-byte prefix + JSON + payload in, NDJSON out). The `version` field goes away.
- **The detector is independent of the Whisper model.** Silero is a separate verified artifact (885 KB) shipped with the engine binary. The detector is ready with no Whisper model installed, and loading and unloading the Whisper model does not stop running detector streams; a long load does not block message intake and cancellation.
- **Detector streams:** `vad.open{stream}`, `vad.audio{stream, pcm}` → `vad.probs{stream, at, probs}`, `vad.reset{stream}` on a gap (LSTM state reset), `vad.end{stream}` — the last incomplete window is computed with padding inside inference only, and the probability refers only to real samples; `vad.close{stream}`. Each track has its own state. The detector runs on its own thread and does not wait for inference.
- **Recognition:** segment timestamps (currently off). Without a set language Whisper detects the language itself and recognizes the same clip whole; a “detect language only” mode is not used, a detection failure is a refusal. Silence legitimately yields empty text. Inference stream count derives from the machine, not 4; a recognition stream ends normally with no `terminate`.
- **Launch** goes through the process service given by the host composition (Bun in the server, Node in Electron main). The engine needs no macOS permissions, so neither LaunchServices nor the execution host. A process crash fails all waiting clips and detector streams with a gap; the next request raises the engine again.

## Queue and models

- One Whisper model is loaded; clips from all tracks go through one queue bounded by sound duration (overflow is a gap); cancellation removes its own clip; a request for another model while running is a refusal; the model unloads after idle time.
- **The model store** keeps the old `WhisperModelStore` approach — download with resume into a temp file, SHA-256, atomic publish, receipt — on Effect Schema instead of zod, and fixes its defects: a write verifies all bytes were written; the file's actual size and hash are verified before publish; any refusal closes the network read; cancellation is checked before publish. An installed model is not rehashed on every use after that: the install receipt is the trust boundary.
- The engine binary and Silero are built from checkout and live in the install directory; Whisper models live in the data directory; the host gives the paths.

## Availability

Where the engine is not built (now everything but macOS arm64), composition gives the detector `none(reason)`, and the `whisper` provider declares its models unavailable with a reason. Then `client` mode is also unavailable; the other cloud modes work. Building for Linux and Windows on CPU lifts the limit and does not change the architecture.

## Proof

- Host against a fake engine process (integration): queue in order, own-clip cancellation, second-model refusal, process crash gives failure and a gap, the detector answers during model load and inference.
- Store (integration): resume; a short write and a wrong hash install no model; cancellation before publish publishes nothing.
- Native smoke: speech with no set language gives text and a language; silence is empty text; `vad.end` returns the tail's probability; `vad.reset` separates two segments.
