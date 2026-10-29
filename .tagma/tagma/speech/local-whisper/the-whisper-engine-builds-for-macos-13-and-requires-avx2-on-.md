---
id: 01a175fa-2f7f-72a8-bb68-a46fadf8f8ef
title: The Whisper engine builds for macOS 13 and requires AVX2 on x64
ord: 7
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/speech-whisper/scripts/build.ts
---
The app declares `LSMinimumSystemVersion` 13.0, and a 2017 Intel Mac — the oldest macOS 13 installs on — never updates past 13. With a minimum system of 14, dyld would not launch the engine on it, and Whisper would silently vanish exactly on the oldest machines, so `CMAKE_OSX_DEPLOYMENT_TARGET` equals the app minimum and moves with it.

The x64 build cross-compiles on Apple silicon with `GGML_NATIVE=OFF`: ggml picks the x86 variant by `CMAKE_OSX_ARCHITECTURES` and enables SSE4.2, F16C, FMA, BMI2, AVX, and AVX2. Every Mac that macOS 13 installs on normally is Skylake or newer and can do all of this; a CPU without AVX2 never gets macOS 13 normally. Metal is also built for x64; whether it works on an Intel Mac GPU and at what speed is unmeasured.
