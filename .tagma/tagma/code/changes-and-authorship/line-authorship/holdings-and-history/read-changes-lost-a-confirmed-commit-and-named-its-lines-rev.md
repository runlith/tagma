---
id: 01a16e33-cb46-75cc-9dc1-d81134eabca3
title: read_changes lost a confirmed commit and named its lines reverted
ord: 14
tags: ["reflection"]
fields:
  {
    "actual": "read_changes did not list 9579e2303f in commits and showed both files withdrawn (reverted), though git merge-base --is-ancestor 9579e2303f HEAD returned 0 and git diff --quiet 9579e2303f HEAD -- both files returned 0.",
    "command": "read_changes({limit:15}) after submit_work({subject:\"Test pin admission in unit and persistence on the shared SQL world\",paths:[\"apps/tagma/server/src/composition/testing/threads/pins.itest.ts\",\"apps/tagma/server/src/threads/pinOffers.test.ts\"]}) returned 9579e2303f",
    "expected": "Own lines in a commit HEAD reaches show as committed with that commit; the commits list holds the confirmed submit_work commit."
  }
---
Filed from project `runlith`.

In the same checkout the later submit_work 1b8b4ecbd5 is listed correctly. The files themselves were not lost: both clean and byte-identical with 9579e2303f; that is a lost commit fact and authorship in read_changes, not a file restore. Session 01a16ded-91b6-7920-b042-6c8487cbafcb; no extra tests were launched for the check.
