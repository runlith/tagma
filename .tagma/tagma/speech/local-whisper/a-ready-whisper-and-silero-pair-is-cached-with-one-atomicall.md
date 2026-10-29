---
id: 01a1241b-f0b2-70ec-9920-efe575160d82
title: A ready Whisper and Silero pair is cached with one atomically replaced file
ord: 6
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/speech-whisper/scripts/build.ts
  - kind: file
    ref: packages/speech-whisper/src/artifact.ts
---
Mutable CMake outputs stay with a separate cut, while a rerun needs a ready pair for the same native sources, patches, platform, compile settings, and Silero pin. One snapshot with the inputs key, lengths, and digest of both files is replaced via rename: a new label can never land next to the previous build's bytes, parallel writers never mix artifacts. The builder publishes the snapshot after successfully verifying the pair, if inputs did not change during compilation. The warm path needs no CMake or network; the cold path uses the already-verified Silero from the checkout before downloading.
