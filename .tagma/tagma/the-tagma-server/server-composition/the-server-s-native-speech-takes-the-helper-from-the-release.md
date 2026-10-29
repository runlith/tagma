---
id: 01a10733-475e-7138-9f98-0ce805789311
title: The server's native speech takes the helper from the release directory's app copy and looks it up on every request; the Whisper engine — from the install or checkout; the models — from the data directory
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/speech.ts
  - kind: file
    ref: apps/tagma/server/src/installation/cut/engine.ts
  - kind: file
    ref: packages/audio-darwin/src/channel.ts
---
The sound helper comes from the app copy the release keeps: `install/<v>/desktop/<channel name>.app`. An installed server takes it from its own release, a checkout server from whatever stands in `current`. Where the person keeps their app does not matter to the server: moving, renaming, or deleting it does not lose the helper. A helper from its own release speaks the same protocol as the server, so the protocol does not diverge between releases. The app path resolves on every channel `open` (`DarwinChannel`), and `availability` reopens the helper each time, so a helper appearing after startup is found without a restart. Without a helper, `AudioDevices` answers `absent` with a reason. The macOS permission is expected under the same signature and bundle id as the person's app; for Developer ID this is unmeasured.

The release puts the engine binary and `silero.bin` in the install's `tools/`. A checkout server takes them from `packages/speech-whisper/bin` and computes this path at runtime: the release rejects a closure whose text holds a checkout path. Where there is no engine, composition gives the detector `none` with a reason and the `whisper` provider `unbuiltProvider`; it does not check the process architecture, so the x64 release includes Whisper, under Rosetta too. A release without engine tools (no `cmake`, Silero not downloaded) does not refuse: the engine build exits with code 3, the release puts `tools/whisper-engine.absent` with the reason instead of the engine and inventories it, and composition shows that reason. The checkout build writes the same file. Cloud modes keep working.

Whisper models live in the data directory's `speech-models`, so they survive install rebuilds.
