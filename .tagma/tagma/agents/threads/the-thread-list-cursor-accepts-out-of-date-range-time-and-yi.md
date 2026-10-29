---
id: 01a15134-0b9f-7e2c-809e-ec145735782e
title: The thread-list cursor accepts out-of-Date-range time and yields an empty page
ord: 63
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15136-4984-7146-a28a-9d93e64082da",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15120-d727-72aa-b665-acc0f13fcc59
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/list/wire.ts
---
In `apps/tagma/server/src/threads/list/wire.ts:151–155` the `before` cursor is checked for a finite number but not for a valid `Date` time: JSON `{"at":1e20,"id":"x"}` passes and yields `Invalid Date`. `list_threads` passes it through `threadSelectionOf` (`threads/operations/reads.ts:117–122`) into `threads/list/store.ts:195` and `threads/list/select.ts:80–83`; `getTime()` becomes `NaN`, SQLite binds it as NULL and returns an empty page instead of an invalid-cursor refusal. A public `threadSelectionOf` probe on Bun answered `{"cursorAccepted":true,"validInstant":false,"ms":"NaN"}`; a separate SQLite check `select 1 where 0 < ?` with NaN returned `[]`. Fix: Schema decodes the cursor JSON with a finite time in Date range and a non-empty id. Public threadSelectionOf rejects at=1e20 with a selection shape, the normal page position survives continuation; wire.test.ts — 19 pass. The general server `bun run typecheck` after the edit ended with 68 errors in 12 files of neighbouring unfinished work, with no diagnostics in the changed wire.ts and wire.test.ts; a fully green server typecheck is unproved.
