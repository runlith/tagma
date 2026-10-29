---
id: 01a16ec3-74fc-75cd-8b57-833970ce25c1
title: Eliminate the hosted approval readiness race in ContributorWithdrawal
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16ded-91b6-7920-b042-6c8487cbafcb",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16b01-cb85-7e31-9936-47664dbd9a84
---
Fixed the readiness race in the test: Questions saves and announces the question before transport.reached and progress publication, so the open record does not yet guarantee awaiting-question. Instead of polling that record, the test subscribes to the public live feed before the call and waits for the needed phase. Both scenarios over the memory adapter moved into ContributorWithdrawal.test.ts: all 14 assertions preserved, seeds 1–3 green under unit guards without resources; package typecheck green. Commit 61f0e095b4; red proof is the original rehearsal at HEAD dda5dda6ba — run alone on main before the fix, the race did not show.
