---
id: 01a13a8b-26a0-7e63-a080-cafd09cdbb7f
title: VoiceProcessingIO ducks other programs' audio, so the call microphone runs without it, and the helper sets ducking to minimum
ord: 9
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/speech/dictation/Dictation.svelte.ts
  - kind: file
    ref: apps/tagma/server/src/speech/listening/echo.ts
  - kind: file
    ref: packages/audio-darwin/native/Sources/AudioCore/Output.swift
  - kind: symbol
    ref: apps/tagma/server/src/speech/listening/booth.ts
    symbol: CALL_TRACKS
---
VoiceProcessingIO (`echoCancel` on the microphone) can duck other programs' audio and uses the sound of its own output unit as the reference, not the whole system sound of the call. So the call microphone is captured without VoiceProcessingIO by default, as is Tagma dictation. Call echo cancellation is enabled separately through `speech.calls.echo`: WebRTC AEC3 subtracts the system-sound reference from the microphone when the track formats match and the output is defined as speakers; the setting is off by default and does not apply to dictation. When capture is explicitly requested with `echoCancel`, the helper on macOS 14+ sets `kAUVoiceIOProperty_OtherAudioDuckingConfiguration` with enhanced ducking off and the level at `min`; on macOS 13 the system ducking remains.
