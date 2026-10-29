---
id: 01a0c83d-a948-705b-9759-5feb6cb7053e
title: Build the zone for the overlays kit's testing door
ord: 86
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c84b-6441-7e9f-94ed-72aaf0cb8493",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c83d-a829-7d4b-bfbb-6824de36c9fd
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: packages/primitives/src/test-utils
  - kind: file
    ref: packages/primitives/src/ladder.test.d.ts
  - kind: file
    ref: packages/primitives/src/testing.ts
---
Fill [[a848f76f]] with the claims its code establishes. Read `src/testing.ts` and every file under `src/test-utils/` whole, with `src/door-laws.test.ts`, which runs the real door and the published double through one set of cases. Watch: which of the double's behaviours are laws that suite enforces on both sides and which are the double's alone; why the double keeps its live requests in a reactive map and what a plain one cost before; why presentation is a call the test makes rather than something the double does on open, and which distinctions — a mark, a latch, a cooldown — rest on that; what each handle double records, and what the toaster stub counts as a call. The ladder declaration and the helpers under `test-utils` reach no entry, so say what this door publishes and what it does not. A rule is likely here in the shape of the kit's own: production code does not import this entry, and only this rule keeps it out. Every claim hangs under that area, bound to the narrowest sources that can contradict it and verified after a reading of all of them. Done when the area's body is corrected wherever the code contradicts it, `run_doctor` over its paths leaves nothing open, and a review passes. The module is [[de36c9fd]]; the reference shape is the Layer kit [[59cc3c49]], whose testing door [[33d7f6dd]] is the shape to match.