---
id: 01a1b22e-95d0-7761-910d-8ab3098cc929
title: The keyring Codex login test waited to its bound for the account row on the Linux runner
ord: 37
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19eb2-4a56-79d0-9dbd-af67ec98a662",
    "status": "in_work"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/loginBirth.itest.ts
---
In Linux integration run 42271326976 (commit e06fa0e31, shard 3) `apps/tagma/server/src/composition/testing/loginBirth.itest.ts` — "a file-held Codex login serves the first native prompt while a keyring-only login remains available to the CLI" — answered the first `read_model_defaults` (`unconnected`) at 18:32:55 and then waited until the 180 s bound in `next(...)` over `AccountQuota.changes` for the codex row with no problem, default, and an `openai-oauth` borrower whose problem is `unreadable`; no other request followed. `changes` is `SubscriptionRef.changes`, so the current table is replayed and a missed frame is not the cause. The only warnings came at teardown ("the CLI login watch is unavailable … the watch process closed its channel"). Locally the file passes three runs out of three, and the same file passed in run 42270301141. Find which owner never produced that row on the runner — the keyring discovery, the lent-borrower reading or the login watch the stream starts — and end the wait on its fact.