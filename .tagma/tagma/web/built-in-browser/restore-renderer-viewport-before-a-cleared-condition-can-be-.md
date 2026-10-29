---
id: 01a18665-6e4c-77bc-b17d-806af99cd9bd
title: Restore renderer viewport before a cleared condition can be read
ord: 46
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18627-3d95-7c84-bfb1-c1ee81a96b0b",
    "status": "done"
  }
---
Restore a renderer-size fact at the emulation owner: viewer layout can clear native metrics immediately before an already-queued agent action reads DOM geometry, and attachment applies persisted metrics before its operation continues. The emulation success/refusal answers themselves only project stored state. The reported refused-condition read saw restored user agent with stale iPhone dimensions; local runs have not reproduced it. A forced screenshot is not a generic post-resize fact because remote Cocoa can apply native bounds after its current surface generation was selected. The engine now retains native dimensions from the renderer on attachment and no-override resize events; writes settle on renderer size with resize-event wake-ups. A new immediate successful device→clear read reproduced [393,852] instead of [1280,657] on seed 2 (run.43560.1793259244326); limiting uncertainty to independent resize events made the exact rollback and clear assertions pass on seeds 1/2/3. Review found a pre-override native-sample race; its public-operation unit regression hit the generic 180 s hang guard before invalidation and revision-stable sampling, then completed in 22 ms. Final automation tests passed 9/9 on seeds 1/2/3; condition seeds 1/2/3 and the whole managed engine/screencast run passed 40 tests. One final Apple M2 Max sample measured set at 22 ms, clear at 11 ms, refused combined write plus rollback at 77 ms, and no-op clear at 0 ms at millisecond clock resolution. Capture uses a separate surface-generation fact: source proves the local in-process macOS path for both hosts; the remote-Cocoa counterexample is unreachable, so no capture task is needed.