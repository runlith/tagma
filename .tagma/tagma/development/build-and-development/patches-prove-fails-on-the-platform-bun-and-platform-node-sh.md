---
id: 01a184e0-d01e-7381-a7ec-1cb9b828c876
title: patches:prove fails on the platform-bun and platform-node-shared manifests
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a184e0-f0e6-7bc6-aada-a6e0be4868d7",
    "status": "done"
  }
---
`bun run patches:prove` exits 1 on two manifests unchanged since the initial commit:

- `patches/@effect%2Fplatform-bun@4.0.1.hunks.json`: the marker `listening` owns only part of the patch — `dist/BunWorker.js` blocks 2 and 3 and `src/BunWorker.ts` blocks 3 and 4 have no owner.
- `patches/@effect%2Fplatform-node-shared@4.0.1.hunks.json`: its trap `packages/executions/src/FilePosition.itest.ts` does not exist (vitest: "had no matches"), so "red without it" is a runner failure, not a proof, and the whole patch reads RED.

Done when both hunks own every block and each is red without itself through a trap that exists, and `patches:prove` exits 0. README sections of both patches name the traps.

The existing `hostExit.itest.ts` trap also proved green without the worker hunk after its code moved into a bundled child beyond the proof preload. Its replacement exercises the real `BunWorker` runner directly and proves immediate unready-worker teardown with a controlled shutdown clock; the file trap exercises both public sought writes through `BunFileSystem.layer` on real files.