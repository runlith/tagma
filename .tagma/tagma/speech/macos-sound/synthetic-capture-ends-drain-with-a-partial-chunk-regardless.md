---
id: 01a106df-f903-7c1d-bdd8-f2aec862e9e9
title: Synthetic capture ends drain with a partial chunk regardless of the timer boundary
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/audio-darwin/native/Sources/AudioCore/SyntheticInput.swift
  - kind: file
    ref: packages/audio-darwin/native/Tests/AudioCoreTests/CaptureTests.swift
---
Conformance checks tail preservation on `stop`, so the synthetic source ends drain with a short record that yields one sample after resampling. Regular records yield half a chunk each; without the trailing sample, stopping exactly on a full-chunk boundary would turn the tail check into a timer race. `abort` creates no trailing record.
