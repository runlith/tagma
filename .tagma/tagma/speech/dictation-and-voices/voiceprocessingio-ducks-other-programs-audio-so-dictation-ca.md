---
id: 01a13a8b-26a0-7e63-a080-cafd09cdbb7f
title: VoiceProcessingIO ducks other programs' audio, so dictation captures the microphone without it, and the helper sets ducking to minimum
ord: 12
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/speech/dictation/Dictation.svelte.ts
  - kind: file
    ref: packages/audio-darwin/native/Sources/AudioCore/Output.swift
---
VoiceProcessingIO (`echoCancel` on the microphone) can duck other programs' audio and uses the sound of its own output unit as the reference, not the whole system sound. So Tagma dictation captures the microphone without VoiceProcessingIO. When capture is explicitly requested with `echoCancel`, the helper on macOS 14+ sets `kAUVoiceIOProperty_OtherAudioDuckingConfiguration` with enhanced ducking off and the level at `min`; on macOS 13 the system ducking remains.
