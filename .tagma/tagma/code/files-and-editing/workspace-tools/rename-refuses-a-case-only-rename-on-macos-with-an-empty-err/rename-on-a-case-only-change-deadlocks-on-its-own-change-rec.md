---
id: 01a15000-068e-7423-bf90-3df8a4dd5673
title: rename on a case-only change deadlocks on its own change-record turn for 60 s, then fails with an empty HoldCut
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "Both parallel calls hung 60 040 ms and 120 040 ms and ended \"[rename] error: \" with no reason; nothing was moved",
    "command": "rename {from: \"apps/tagma/app/src/lib/shared/theme.svelte.ts\", to: \"apps/tagma/app/src/lib/shared/Theme.svelte.ts\"} (thread 01a14ff7-54a2-7e06-a406-57dc2c8672a9, toolu_01DZWoc9…, toolu_014YXsY1…)",
    "expected": "The case-only rename lands at once (recordingMove already handles sameEntry via fs.rename)"
  }
---
Filed from project `runlith`.

Root cause read from code, not reproduced. `inTurns` (packages/agent-tools/src/changed.ts) dedups the two spellings by exact string and nests `Intake.turn` for each. On the server, `placeOf` → `CheckoutPaths.spelled` (apps/tagma/server/src/workspace/checkouts/paths.ts) lstat-s `Theme.svelte.ts`, finds the existing entry on case-insensitive APFS and returns native `realpath` — the stored spelling `theme.svelte.ts`. Both spellings therefore map to one `placeKey`, and `intake.turn` (change-record/record/intake.ts:393) takes the same `Semaphore(1)` twice inside itself: a self-deadlock, cut only by the agent-tools lock hold ceiling (60 s, `fileWriters`/`directories` in workspace/runtime.ts). The second call waited behind the first on the shared directory lock, hence 120 s. The empty message is the HoldCut reason, same shape as ecafcea1. Fix belongs at the turn: one turn per place, not per spelling.