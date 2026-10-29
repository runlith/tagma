---
id: 01a13b36-e850-7b1c-9ef8-e237516ba42b
title: The helper assigns default output to speakers or headphones by transport and data source; what it did not recognize is unknown
ord: 6
tags: ["explanation"]
sources:
  - kind: symbol
    ref: packages/audio-darwin/native/Sources/AudioCore/Hardware.swift
    symbol: outputKind
---
HDMI and DisplayPort are `speakers`; Bluetooth, Bluetooth LE and USB are `headphones`; built-in output follows the data source (`kAudioDevicePropertyDataSource` in the output scope): `ispk` is `speakers`, `hdpn` is `headphones`. Everything else — AirPlay, virtual and aggregate devices — and any read failure yield `unknown`; synthetic mode always answers `unknown`.

A mistake toward `headphones` (a Bluetooth or USB speaker) only leaves echo, as without the suppressor, so classification is cautious in exactly that direction. On Apple silicon Mac speakers are a separate built-in device with the `ispk` source (operator's machine, 2026-10-14).
