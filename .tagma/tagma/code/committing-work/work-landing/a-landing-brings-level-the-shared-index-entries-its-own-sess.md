---
id: 01a0de23-721a-700a-9ba8-3af5f5f91a33
title: A landing brings level the shared-index entries its own session staged, and names the `paths` entries it could not match even when it lands
ord: 41
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0de17-2c92-7c71-ab40-546a507a975f",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0d69e-6399-7196-9baf-42d6c1e50a06
sources:
  - kind: file
    ref: apps/tagma/server/src/protocol/submitReceipt.ts
  - kind: symbol
    ref: apps/tagma/server/src/landing/land/submit.ts
    symbol: submitWork
---
Reflection [[c1e50a06]]: after `git mv` ×13 and edits, commit 7b80c8c7f6 landed the new paths, while the shared index kept 10 staged pre-edit copies of them (a later plain commit would revert the edits) and 4 staged deletions of old paths the session did not hold; the landed receipt did not say that 4 `paths` entries matched nothing.

- `syncIndex` levels only entries still equal to a base the landing stood on. An entry the session's own command staged — its text's digest is an after-hash of one of the carriers' rows or observations on that path — is the session's own superseded staging and is levelled too; anyone else's staging stays as they staged it.
- The `landed` receipt carries `unmatched` as `nothing` does.

The old paths' deletions stay out: a `git mv` without `produces` naming both ends, or without the `rename` door, leaves them unattributed ([[fbccc7f3]] says so in the shell's answer). Done when integration tests cover both.