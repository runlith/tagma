---
id: 01a16ff7-98a3-7beb-a9c2-30f21d28d278
title: The door world and terminal world take the host from the run's bundle as a closure; `hostSourcePath` gives its own world with a checkout-built host
ord: 26
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a16ff7-61e7-7789-acb4-63137c0fd0a0
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/hostBundle.ts
  - kind: symbol
    ref: apps/tagma/server/src/composition/testing/doorFixture.ts
    symbol: doorWorld
  - kind: symbol
    ref: apps/tagma/server/src/composition/testing/fixture.ts
    symbol: terminalWorld
---
A runtime with `hostSourcePath` spawns `bun packages/execution-host/src/buildArtifact.ts` on the host's first offer: it hashes all execution-host closure sources and, on a machine-cache miss, builds the bundle under the cache flock with up to 60 s of waiting. When neighboring agents change the closure mid-run, builds go cold and wait for each other: the door world hung in its hook for 60 s at a time, and every worker paid a bun child and hashing for each such world.

So the door world and terminal world without `hostSourcePath` offer the host from the run's bundle (`hostBundleRoot`, the run world) as a closure — `makeRuntime({ hostBundlePath })`, the same path as the install server's: a copy of parts and verification, no build. The host parameter is gone from the shared-world key, and all worker files share one door world.

`hostSourcePath` gives a separate world and stays for tests whose subject is offering a checkout-built host. A source server, which the test raises as a separate process, still assembles the host itself: the run's bundle is published to the same machine cache, so with unchanged sources it takes it as a copy.
