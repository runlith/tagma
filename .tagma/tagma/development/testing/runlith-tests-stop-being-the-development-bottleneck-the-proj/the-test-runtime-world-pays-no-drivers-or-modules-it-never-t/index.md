---
id: 01a16ac4-44bf-7e0a-8178-b703be3ac0e2
title: "The test runtime world pays no drivers or modules it never touches: modules declare drivers in the manifest, heavy modules load in place"
ord: 4
tags: ["spec"]
fields:
  {
    "status": "open"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/runtime.ts
---
**Measurement.** In a full-runtime world prober (`makeDoorWorld`, one test), importing the module graph cost 1.6 s CPU of the own process, `makeRuntime` 4.4 s. At build the world spawns `osascript`, `ps`, `pgrep`, and a watcher process, and the rules remeasure driver, which connects `enforcement/serving.ts` (`:27`, `:128`, `:163`), managed to start and fail in the background on a repo without a project HEAD. The test called one operation for 0.05 s. 139 server test files raise the runtime world; `composition/runtime.ts` statically imports 197 modules.

**First step — inventory and profile.**
- An inventory of background passes: which drivers and processes the built runtime raises, who connects them. Today drivers live inside module installation layers (remeasure — `forkScoped` in `enforcement/serving.ts`), and the module manifest has no field for them.
- A runtime-build profile. `bun test --cpu-prof` recorded no profile in this environment, so the build is profiled by a script outside `bun test`, with the same input as `makeDoorWorld`: the import, migration, layer-build, driver, and process shares.

Both refine the direction below.

**Direction.**
- Modules declare their drivers in their own manifests ([[edea5454]]), composition assembles them. That is a product-architecture change, not tests-only. Product composition starts all of them as today: a driver whose words promise boot or cadence stays connected ([[a00f91b0]]).
- The test world starts the product's drivers by default: a defect or race test stands in the real caller's environment ([[571311f8]]). A world that declares "no drivers" or their list gets only those; that is how worlds of tests declare that drivers are not their subject.
- Heavy modules load where used, or lazily — in the spirit of [[0d2c66a9]]. Every new `import()` is an edge of the selection graph [[05af9265]].
- Whatever cuts import and build also cuts the user's server start; that gain is measured separately and recorded.

**Remainder: lazy heavy modules — deferred.** Speech (audio-file, speech, and engines), browser (cdp, managed, and desktop browser), and models (adapters) are about 1.7 MB of ~25 MB loaded source, roughly 7%. Their installation layers build on every build. So an `import()` instead of a static import only moves the cost from import to build, and never loading them at all needs services built on first use — a rebuild of speech and browser assembly. The door world cannot avoid models either: `makeDoorWorld` itself selects every provider mode and model during build. By the 2026-10-24 decision, this is not being implemented in [[e2afec3a]]: an upper bound of ~7% of loading never pays for rebuilding two modules. Measurements in [[c46fbf55]].

**Owner.** Server composition ([[13182a9f]]) and the modules whose drivers move into the manifest.

**Acceptance.**
- The background-pass inventory and the runtime-build profile recorded before and after.
- Product composition starts the same driver set as the inventory.
- A runtime world that declared "no drivers" spawns no background processes: the run report shows only the project's SQLite and git.
- The runtime world's build CPU and the server start time measured before and after.
