---
id: 01a188d1-3fe0-7457-8e14-f1e43505f7f7
title: A pick after the cross-site frame-pick scenario refuses Overlay.enable on a session that no longer exists
ord: 50
tags: ["task"]
fields:
  {
    "holder": "tagma:01a188d1-7aba-7a82-ad48-d0ab8ae7c722",
    "status": "done"
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

Trace proved the cause on managed Chromium 151, seed 2: the Later frame session (4AC43F85…) auto-attached the Deep frame session (BA0BD94F…) through its own session. On main-frame navigation, Chromium detached the two direct children (65656DF4…, 4AC43F85…) but never sent a separate detach for BA0BD94F…. At the failing pick, `attached.children` still contained BA0BD94F…, its DOM domain was held, and Overlay was not yet held. The trace was captured through temporary engine instrumentation, removed after diagnosis. `joinChild` now records the attachment parent and `leaveChild` retires the entire descendant session subtree, including adoption scopes, probes and domain leases. The shared scenario now navigates to `/pick` after the nested frames and asserts a fresh pick returns `#target`; with the fix disabled this fails on seed 1 with the same Overlay refusal (30 pass, 1 fail).

Green: both engine files, 62/62 on seeds 2 and 3; managed seed 1 plus screencast, 40/40; browser/automation.test.ts, 11/11. Desktop seed 1 remains blocked by the unrelated host hangs tracked in [[9c60187f]]; desktop-engine authorized landing this fix independently. One independent review (gpt-6.1-sol xhigh) found quadratic descendant retirement; the final implementation indexes attachment parents once and walks the subtree iteratively. Server typecheck reports only the existing missing DOM globals in composition/testing/column.e2e.ts.
