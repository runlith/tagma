---
id: 01a13f55-a0e1-7a12-b89d-7e1585320461
title: Test worlds take the host bundle from the machine cache by input hash instead of rebuilding it
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13f3e-1fcf-7a50-a966-a06b491dd6a6",
    "status": "done"
  }
sources:
  - kind: file
    ref: packages/execution-host/src/buildArtifact.ts
  - kind: file
    ref: packages/execution-host/src/composition/nativeBuild.ts
---
Every world with an execution host (test worlds via BUILD_SCRIPT, doorFixture/runtime, and the dev server via `offer.ts` `running`) rebuilds the CLI host bundle `packages/execution-host/src/buildArtifact.ts` from scratch. That is ~1.3 s of CPU and 77.6 MB of writes per world, because the bun copy is rewritten every time. Under load another ~2.4 s of wall goes to `rustc -vV` in nativeBuild.

Do this: the built bundle is cached in one machine place by input hash and laid out into the world without copying bytes; `rustc -vV` leaves the fresh-receipt path. World behaviour does not change.

Done when a cache hit through the CLI costs fractions of a CPU second and kilobytes of writes, bundles from the cache pass verifyArtifact, and `nativeBuild.itest.ts`, `bundleBoot.itest.ts`, and one world (`environmentRoad.itest.ts`) pass.
