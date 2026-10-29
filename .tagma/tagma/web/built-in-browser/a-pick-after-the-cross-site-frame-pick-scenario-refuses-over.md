---
id: 01a188d1-3fe0-7457-8e14-f1e43505f7f7
title: A pick after the cross-site frame-pick scenario refuses Overlay.enable on a session that no longer exists
ord: 50
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a1845c-e541-7522-be69-64776febfab1
sources:
  - kind: file
    ref: apps/tagma/server/src/browser/engine/cursor.ts
  - kind: file
    ref: apps/tagma/server/src/browser/engine/frames.ts
---
After the shared scenario `cross-site frame picks survive captures, include frames attached later and end with their feed` has run on the engine page, the next pick on that page fails on both hosts: `GateRefusal: action-failed: the browser refused Overlay.enable: Session with given id not found`. The dev-pick scenario then hangs to the 3-minute test guard, and the file's later groups fail in their hooks.

Reproduction: `apps/tagma/server`, `testbed bun test --no-isolate --randomize --seed=2 ./src/managed-browser/engine.itest.ts`. 27 pass, 6 fail; the failing picks follow the frame-pick scenario in that order. The same holds for `./src/desktop-browser/engine.itest.ts` on seed 2. Seed 1 and the declared order run the picks before the frame-pick scenario and pass. The failure stands with the scenario as it was before task 6febfab1's edit to `picking.ts` (reverted for the check), so it predates that work.

Reading, not yet proved by a trace: `picking` in `engine/cursor.ts` enables `Overlay` on every `attached.children` session whose `DOM` domain is held. `joinChild` in `engine/frames.ts` retires an outgoing session's frames but leaves that session in `attached.children`. A main-frame commit retires descendant frames in `commitFrame`, while the child sessions rooted in them stay registered when Chromium omits their `Target.detachedFromTarget` (see explanation 9883a92d). A dead session left there would answer `Overlay.enable` with exactly this refusal.

Done when the seed-2 order passes on both hosts with the cause fixed where child sessions are registered and retired, proved red then green by the scenario order that exposed it.
