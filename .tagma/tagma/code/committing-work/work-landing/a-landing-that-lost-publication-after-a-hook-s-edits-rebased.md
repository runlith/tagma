---
id: 01a14599-4565-7a5a-8e99-c861af247564
title: A landing that lost publication after a hook's edits rebased the old tree and did not commit the edits
ord: 24
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1457e-b3df-721a-b633-e86cc903d6a8",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14583-1237-7b7b-b1c3-31e015608150
sources:
  - kind: symbol
    ref: apps/tagma/server/src/landing/land/commit.ts
    symbol: commitOwn
---
Since `0fd1db6fad`, an attempt that lost publish (`moved`) always rebased prepared onto the new HEAD. When that attempt's hooks had edited the tree, the edits had already reached the working files as the session's lines, but the rebased tree was assembled before them: the retry committed a version without the edits, contrary to the [[5d90de70]] contract. `submitGit.stest.ts` "a landing retried because HEAD moved keeps what the hook edited…" failed.

Do: after a lost publication with hook edits, the retry assembles the commit from scratch; without edits it rebases. Proof: all of `submitGit.stest.ts` and `submitMoving.itest.ts` green.
