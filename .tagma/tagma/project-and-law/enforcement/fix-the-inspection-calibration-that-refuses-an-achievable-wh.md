---
id: 01a1320f-535a-7362-b43b-056839326f7d
title: Fix the inspection calibration that refuses an achievable whole-project judgment
ord: 35
tags: ["task"]
fields:
  {
    "holder": "tagma:01a131f4-910d-701b-be58-3eaae8ab0c6a",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a131f4-6516-7338-bbc6-44dc18285ad5
  - kind: discovered-from
    to: 01a13206-c04b-7cb2-8cb4-9dc95b6e8e72
sources:
  - kind: file
    ref: apps/tagma/inspection/src/core/node/budget.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/workers/calibration.ts
---
Fix the overestimated whole-project builtin inspection calibration with no cap and gate change. Implementation landed in 910ab0347c: one probe time is no longer written off twice, the sample spreads over the set, a disk-stored estimate outside budget is remeasured; an unknown axis refuses typed. Reasons are recorded in the [[6d23a281|model note]] and the [[51e5e023|sample note]]. Red/green guard the sum, prefix bias, rereading a stored calibration and a zero axis; 27 tests pass, inspection typecheck clean. Sol and two Muse lenses ran one review round, confirmed remarks fixed. Whole reach of the current source worker on HEAD bd0aac1522f16b6e74c803a73126a9043ce8c42a answered in 65.245 s, readFiles 3890, 88 violations and 58 unjudged; the new probe 226.38 ms/16 files/0.06736 MiB versus the old 229 ms/0.01846 MiB. This is one sample under shifting load. The enforce_rule and check_rules (over: all) operations on the final tagma:try stay unverified: the surface build failed on someone else's MISSING_EXPORT BUILD_CHECKOUT_FEED in app/src/lib/wire/liveGroup.ts; a full server typecheck also fails outside the change, 96 errors in 6 files. The check instance is stopped. The working server is restarted by the operator; then the archiving task updates the old allowance through enforce_rule.
