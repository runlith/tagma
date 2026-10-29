---
id: 01a1083a-71e5-7327-b191-f578cc3fc7ad
title: System capture takes its format from the tap, and IO waits for the aggregate to publish input
ord: 5
tags: ["explanation"]
sources:
  - kind: symbol
    ref: packages/audio-darwin/native/Sources/AudioCore/Hardware.swift
    symbol: SystemTap
---
Right after tap list write the private aggregate is already `alive` and has a stream, but its input configuration is empty, and `kAudioDevicePropertyStreamFormat` in the input scope answers `'who?'` (`kAudioHardwareUnknownPropertyError`). Input appears asynchronously — measurement on macOS 26.0.1: 10–100 ms, in two of three runs the first read failed. Waiting for `alive`, as the old audiotee did, does not catch this.

So the track format is read from the tap itself (`kAudioTapPropertyFormat`, available right after creation), and `SystemTap` listens for `kAudioDevicePropertyStreamConfiguration` until tap list write and returns only when the aggregate's input channel count equals the tap's channel count. The listener is installed before write so the publication is never missed. The configuration can grow between reading its size and the data itself — CoreAudio then answers `'!siz'`, and the read repeats with the new size (the live run of 2026-10-04 failed exactly on this); the deadline is 2 s, after it — a `device-failed` refusal, not an IOProc on a device with no input.

The first capture without the `kTCCServiceAudioCapture` permission raises a dialog on tap list write (not on tap creation). Whether the dialog blocks the write itself or only input publication was not measured; in the second case an answer slower than 2 s refuses the first attempt.
