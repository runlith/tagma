---
id: 01a1166f-7113-7752-b6b9-0a721509a7f0
title: Release workers are derived by the build from the bundle, and server startup without any one of them refuses, with worker failure as a typed failure
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/cut/release.ts
  - kind: file
    ref: apps/tagma/server/src/installation/contract/wire/manifest.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/transcript/restedWork.ts
  - kind: file
    ref: packages/git/src/unpack.ts
---
**Built in full.** The core landed in f40590b15b. The remainder is in 0cbc4d39fb and afdcf7d5ea (task 69a227ce):
- start and successor check verify that all server parts are present; a missing file yields `InstallationUnreadable` with the path;
- `WorkerUnavailable` at worker owners;
- the Bun-adapter Effect patch: `close` without `error` now ends the runner with a typed failure;
- a system test of the built server.

A running server only receives all of this after a new release and a restart, which the operator performs. The sections below describe the state before the build.

This part is built first and closes the "worker missing from the release" class, which has already struck twice.

## What stands now

- **Built in f40590b15b (task 2e147255).**
  - The `packages/bundle` kit (`bundle.ts` `bundle`) assembles every module the bundle runs beside itself — any literal `new URL('./<name>.(ts|js|mjs|cjs|tsx)', import.meta.url)` in the bundle's entry modules (Bun.build metafile). Where the literal stands does not matter: inside `new Worker(...)`, standalone as with judge and reach (`enforcement/workers/inspectionLanes.ts`), or through `new globalThis.Worker` as with the telemetry store.
  - The build refuses when:
    - the bundle runs a file none of its sources names;
    - two sources give one name in the flat directory.
  - The hand-written `*_ENTRY` list is removed from `installation/contract/wire/manifest.ts` and `cut/release.ts`. Everything assembled beside the bundle stands in the `parts` of install.json with the `server` role.
  - The execution host build (`packages/execution-host/src/buildArtifact.ts`) goes through the same kit.
  - In passing, `sandbox/engine/docker/helper.ts` and `proxy.ts` enter the release, but without a Dockerfile they are harmless.
- **Not built.**
  - The working install 20261007T104104162Z predates f40590b15b: it has neither `unpack.worker.ts` nor `rested.worker.ts`. Today's symptom goes away once the operator builds and restarts the server.
  - Worker owners answer the `error` event (`BuildMessage: ModuleNotFound`) with `failed`, and the call silently receives "unread".
  - There is no test over the built release. `packages/bundle/src/bundle.itest.ts` checks a nested worker and name collisions on a fixture.

## What remains

- **Install check at startup.** Before serving calls, the server verifies that every module from the `parts` of install.json with the `server` role stands in the install. If anything is missing, startup refuses with the file name. This is a presence check, not a launch: the defect class is a missing file, and the check needs no worker protocol.
- **A worker failure in operation is a typed failure.** A worker owner writes the `error` or `close` to the log once with the reason and answers `WorkerUnavailable`. The consumer never turns that failure into "no data" ([[fe04fc30]], I6). The next call raises the worker again.
- **System test over the built release.** Every literal `new URL('./…', import.meta.url)` reachable from the server entry point resolves to a file in the release. judge, reach, the telemetry worker, walk and rested are named explicitly in the test: those are the ones the hand-written list missed or a narrow pattern would miss. unpack is removed by the session reader ([[f16c4571]]).

## Owners

- Kit and release — `packages/bundle`, `installation/**`. By agreement with thread 01a10b6b-4914-700e-9ebb-e850cf14b11c this is its area; it does not take the remainder of this part.
- Startup check — composition, over the `parts` of install.json.
- `WorkerUnavailable` and the one-shot log — every worker owner: `native-harness/transcript/restedWork.ts`, `platform/durable/flush.ts`, `packages/agent-tools` (pdf), `packages/ndjson-rpc`, `packages/activity`, `packages/performance`, `enforcement/workers`.
- `change-record/lines/walks.ts` reports a worker death through the existing typed failure `WalkUnfinished` with reason "worker". Consumers already handle it as `walk-cut` or `unknown{reason: worker}` ([[fe04fc30]]), so no new type diverges across change-record.
- The unpack worker in `packages/git` gets no failure of its own: the session reader removes it ([[f16c4571]]), and it answers every path with a typed failure.

## Acceptance

- Starting the server with a `server`-role module removed from the install refuses and names the file.
- The system test above passes on the built release.
- A worker unavailable in operation gives the consumer `WorkerUnavailable`, not "unread" and not an empty answer.
