---
id: 01a14f27-81e2-729a-a00f-315220943807
title: A shape step over meta/reading only rewrites what it touches without a thread rerun; a full rerun happens at open and one at a time in the background
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14a05-5a4d-76a0-b1af-97cb761579da",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a14f27-655b-7b9c-a4a5-f8d22d498c2b
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/journal/rolloutWhole.ts
---
Item 2 of [[2d498c2b|spec]]. Start with `threads/journal/rolloutWhole.ts` (`resident` unloads and returns the whole thread for any step) and `rolloutEntryForms.ts#formRollout`. Proof is spec acceptance 1–3 and 5.

## Result (94b4cf546b)

- `formRollout` forms in place a database-lying thread too when its mark lags only by steps without `payload`/`entry`/`message`; `rolloutWhole.resident` takes that road instead of unload and return. File event lines under such steps copy without `JSON.parse` (which also speeds up unloaded threads).
- itest `formSteps`: event lines and database rows unchanged, meta lines formed, the mark on the last step, `rested_at` unset. Journal itests, `shelf.stest` green; typecheck in `threads/` clean (errors in someone else's `enforcement/*.stest`).
- Measurement, one sample: a 35 MB file pass (7127 lines) — 160–190 ms skipping events versus 232 ms with parsing; the same thread's old rerun — `ThreadRollout.formWhole` 2.8 s.

Not proven: moving every thread on the operator's database copy (14 GB) was not run; total time for 1107 threads depends on their files' combined size (estimate — tens of seconds, not minutes). No independent review: the thread has delegation off.
