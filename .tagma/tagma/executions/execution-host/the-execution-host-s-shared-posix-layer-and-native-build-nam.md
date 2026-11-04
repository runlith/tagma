---
id: 01a1a764-10de-7f61-9e76-e67b44a44563
title: The execution host's shared POSIX layer and native build name the macOS adapter directly, so nothing over the host starts on another OS
ord: 71
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a7ac-e072-7b85-9695-d2b287ff9bb1",
    "status": "in_work"
  }
edges:
  - kind: relates
    to: 01a0eaa1-2c4c-7cbd-9014-d7496f758080
  - kind: relates
    to: 01a19ec6-f467-787a-a87e-89cb77c57d56
sources:
  - kind: dir
    ref: packages/execution-host/src/posix
---
The host's shared POSIX layer and the build tooling name the macOS adapter directly, so the host — and every server runtime over it — cannot start on any other OS, and no OS-independent test over it can run on Linux.

Read at 06131e7f0f:
- `src/composition/platform.ts` selects the platform by `process.platform === 'darwin'` and refuses every other OS with `no host adapter for <os>/<arch>`.
- `src/posix/processes.worker.ts` imports `macos/ProcessAbi`, `macos/Sampler`, `macos/UsageAbi` and `macos/ps`; `src/posix/Library.ts` imports `macos/ProcessAbi`; `src/posix/native.ts` imports `macos/birth`. These are the shared POSIX layer reaching into one adapter.
- `src/buildArtifact.ts` and `src/composition/nativeBuild.ts` import `macos/artifact` (Apple Rust triples only), so the native part builds for no other OS; the server's `test:integration` script runs `build:native` first and therefore stops on Linux before any test.
- Shared test fixtures take the macOS adapter by path: `src/posix/testing/holder.ts`, `src/composition/testing/posix.ts`, `src/runtimeFixture.ts`, `src/hostFixture.ts` (a `darwin` platform literal), and the itests importing `posix/macos/*` (`host`, `ExecutionRuntime`, `ProvenSet`, `nativeLaunch`, `terminalRelease`, `ExecutionCapacity`, `composition/testing/{foreground,processCapacity,terminalCapacity,gpu}`).

Done when the POSIX layer and the build reach a platform only through the platform ports the host declares, the macOS adapter is the only code naming macOS, its own tests are marked as macOS platform tests, and the host's OS-independent tests run on a Linux runner.

Added by the OS audit: `src/buildArtifact.ts:19,209` also imports `@runlith/codesign` and signs every part, so the shared build calls the macOS signing adapter directly; `:63-65` and `:421` compare `process.platform` with the adapter's declared OS and put it into the manifest.
