---
id: 01a12ca6-35fc-7dd4-8bc1-5b7d36a9241b
title: A lost update-ref answer does not turn a published landing into nothing
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12c86-94f7-747f-9d9d-8b4f062231df",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0e848-0df3-734a-9efe-f8fcb3cc0014
sources:
  - kind: symbol
    ref: apps/tagma/server/src/platform/git/publish.ts
    symbol: advance
---
In platform/git/publish.ts, after a lost update-ref answer, advance treats any SHA shift as someone else's publication. Once update-ref has run, retrying prepare returns nothing and leaves the index on the old base. Recognize the publication of our own commit when it matches the read tip or is its ancestor; ancestry is checked by the same owner as the receipt, against an immutable SHA. A reflog entry about a commit already removed from the branch does not license restoring it into the index: in that case it stays moved or the original refusal. Someone else's publication is retried, unreadable proof stays a refusal. Checks go through public submit and cover a lost answer of a successful update-ref, a reachable successor with a separate and with the same file, reset-away, and a refusal before publication; a separate public publish checks index settlement. The first three answer landed with their commit, reset-away doesn't restore cancelled work, a real refusal publishes nothing, someone else's race is retried. Red of the public submit: HEAD with a new commit on a nothing answer; green — three recovery/refusal cases and three public-publish tests. Review by Sol xhigh and two Muse lenses done; confirmed reset-away, full-reflog and missing-negative-check risks fixed. Live check on a fresh tagma:try stayed unproved: the shared checkout doesn't build for lack of credentialSchema; typecheck found 99 errors in others' provider/graph files, changed files not named.
