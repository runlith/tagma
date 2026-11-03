---
id: 01a123fc-a6b9-723b-a9fd-69ccf756a3fe
title: The Whisper cut leaves the checkout engine alone and keeps its own CMake build
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/cut/engine.ts
  - kind: file
    ref: packages/speech-whisper/scripts/build.ts
---
CMake FetchContent unpacks sources and creates configuration files inside the build root; two cuts sharing a root may delete each other's input files before compilation. Installation carves a temp build root and output root for every engine build, copies the finished Whisper/Silero pair into the cut, and closes the scope. The cut builds the engine for the release target (`--arch`): the architecture goes into `CMAKE_OSX_ARCHITECTURES`, and the target's finished pair is cached in its own `whisper-darwin-<arch>.artifact` file, so one cut's two targets never evict each other's cache. The binary, Silero and cache used by the checkout server stay with the package's regular build.
