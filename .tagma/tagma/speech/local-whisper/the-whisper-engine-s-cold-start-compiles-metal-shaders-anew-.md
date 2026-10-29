---
id: 01a10826-e309-7151-bea5-729f1af21a43
title: The Whisper engine's cold start compiles Metal shaders anew for every install path, so the `ready` wait is measured in minutes
ord: 5
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/speech-whisper/src/engine/Engine.ts
  - kind: file
    ref: packages/speech-whisper/src/engine/spawn.ts
---
The engine is built with `GGML_METAL_EMBED_LIBRARY`: it holds the ggml shader source and compiles it via `newLibraryWithSource` when initializing the Metal backend. This happens before `ready`, because the detector probe builds the backend registry, even though the detector itself computes on CPU. Metal caches the result by executable path. Every `tagma build` puts the engine in a new `install/<version>/tools` directory, so the first start of every build compiles anew. On an M2 Max under load this took 12–15 s, a warm start 1 s; this is one sample, weaker machines start slower.

So the `ready` wait defaults to minutes. It catches a hung process, not a slow cold start. A short limit kills the compilation before the cache is written, and then every subsequent start stays cold: listening via whisper kept ending on its own at second 10 on every attempt.

While the engine starts, the track capture is not read. The helper buffer overflows into an `overflow` break, not a failure, and listening continues.
