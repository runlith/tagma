---
id: 01a0ff30-3ce0-7879-8c00-c37a9c5ec1b5
title: "First-delivery adapters: `speech-soniox` and `speech-openai`, one vendor's recognition and synthesis in one package"
ord: 4
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
The first cloud-provider delivery is two adapters of the speech protocol ([[d3bd40f5|speech protocol]]): `@runlith/speech-soniox` and `@runlith/speech-openai`. One adapter per vendor, not per “vendor × function”: STT and TTS of one vendor share a key, authentication, and an error map. Each exports one `SpeechProvider` value and imports only `@runlith/speech` and `@runlith/audio`. The old `transcription-soniox`, `tts-soniox`, and `transcription-openai` are deleted; wire knowledge moves over from them, the frame does not.

## Soniox

- **Recognition, stream.** Moving over are the init message and the error map. `ready` comes after sending init (Soniox does not confirm it separately; the credential was obtained before opening).
- A turn is tokens between `<end>` markers. Final tokens are `Final` with `token` units (each token's time, speaker, and language survive; grouping does not lose them), the non-final suffix is `Partial`, `<end>` is `TurnEnd`, `<fin>` is `Finalized`, an empty frame → `finished` is `Finished`.
- Translation: tokens with `translation_status` go on the `translation` meaning track with `source_language`, with no time of their own.
- Turn modes: `provider` (semantic endpoint) and `none` (word marks exist). Soniox docs: endpointing lowers diarization accuracy, so the request picks the mode for meetings, not a handle.
- Capabilities: `finalize`, marks, speakers, language hints and auto-detection, translation with two-way mode, context.
- **What the adapter no longer does**: cut an utterance by accumulated token count, number utterances (that is the core's), or apply the boundary marker to the whole token window.
- **Synthesis.** Streaming text input: init with `stream_id`, text in pieces, end of text, base64 audio, `audio_end`, `terminated`. `text: stream`.
- REST async does not move over: file input is out of scope.

## OpenAI

- **Recognition, stream** — realtime transcription session. A turn is `item_id`. `ready` comes after the session-update confirmation.
  - `gpt-4o-transcribe` and similar — `provider` (`server_vad`; `speech_started{audio_start_ms}` and `speech_stopped{audio_end_ms}` give `SpeechStart`/`SpeechEnd` with time the old adapter threw away) and `client` (`turn_detection: null` plus `commit`) modes.
  - `gpt-live-transcribe` — `client` only: `turn_detection` is omitted, our detector finds the end of speech and sends `input_audio_buffer.commit`; `input_audio_buffer.committed` binds `item_id` to our commit (`Committed`). No word marks, speakers, or confidence: utterance time is the commit range.
  - `delta` is `Partial` (the turn hypothesis grows to `completed`), `completed` is `Final` and `TurnEnd`, `failed` is a gap over the turn range, not a warning.
  - `Finished` is when every confirmed commit got `completed` or `failed`.
  - 24 kHz input raises the core resampler rate; the adapter does not resample.
- **Synthesis** — `/audio/speech` with streaming output and whole text: `text: whole`, the core accumulates text to `end`. This is plain HTTP, so the adapter implements `Synthesizer` itself on the Effect `HttpClient` bound by the host composition, not through the duplex runner.
- Batch `/audio/transcriptions` is not in the first delivery: the “batch + `Segmenter`” path is needed only by Whisper.

## Next adapters

ElevenLabs, Deepgram (Nova, Flux, Aura), Cartesia, AssemblyAI, Google, Amazon, and Azure connect the same way: a new `speech-<vendor>` package and one line in the host composition. Their contracts are read in [[58882889|the contract matrix]]; where a shape does not fit the event language, the language grows by a shared concept, not by a vendor branch.

## Proof

- Pure `step` on recorded frames of each vendor (unit): several `Final` and `Partial` of one Soniox turn, then `<end>`; translation on a separate track; `completed` of different `item_id` out of order at OpenAI; `failed` gives a gap; a vendor error is a typed failure.
- `ScriptedTransport` (unit): opening frames match the request, model, and turn mode; sound only after `ready`; `Finished` only on the provider's condition.
- Once-recorded live Soniox and OpenAI sessions replay as fixtures; live calls happen only in smoke with the operator's key.
