---
id: 01a13ab2-10aa-7eb6-be0f-5ac9b8ff02ae
title: Without an explicit device the helper does not open the Bluetooth headset microphone, it takes the built-in one
ord: 7
tags: ["explanation"]
sources:
  - kind: symbol
    ref: packages/audio-darwin/native/Sources/AudioCore/Hardware.swift
    symbol: untouchedDefault
---
Opening a Bluetooth headset microphone switches it from music mode (A2DP) to headset mode (HFP). All sound playing through it drops for a second, its volume jumps to the separate headset volume, and the sound itself becomes mono and worse. Measured on AirPods Pro: YouTube stutters and gets much louder. So when the default input is Bluetooth and no device is explicitly selected, the helper takes the Mac built-in microphone when there is one. An explicitly selected device (`speech.microphone`) is taken as is.
