---
id: 01a106d6-0157-7ca4-870e-e52d390a63de
title: Realtime callbacks stay in C; Swift reads the ring after publish
ord: 1
tags: ["explanation"]
sources:
  - kind: dir
    ref: packages/audio-darwin/native/Sources/Realtime
  - kind: file
    ref: packages/audio-darwin/native/Sources/AudioCore/Capture.swift
  - kind: file
    ref: packages/audio-darwin/native/Sources/AudioCore/Consumer.swift
  - kind: file
    ref: packages/audio-darwin/native/Sources/AudioCore/Output.swift
---
CoreAudio calls C callbacks so the realtime path has no Swift ARC, allocations or blocking output. SPSC publishes data release/acquire; accumulated overflow and layout failure belong to the producer until CoreAudio confirms callback stop. If the stop cannot be confirmed, the consumer still finishes, but realtime memory stays until helper exit: freeing it under a possible callback is forbidden. Conversion runs at the consumer, sending at the capture writer ([[a1d9d17c]]): a busy socket never holds the consumer, and audio loss stays an explicit range. When the output graph rebuilds, player rings persist apart from AudioUnits.
