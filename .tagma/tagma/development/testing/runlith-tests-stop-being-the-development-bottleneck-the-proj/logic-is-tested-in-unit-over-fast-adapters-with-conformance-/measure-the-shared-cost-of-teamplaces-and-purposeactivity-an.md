---
id: 01a16e95-f8f4-7dbd-96ef-8c35c4ad0d5c
title: Measure the shared cost of teamPlaces and purposeActivity and remove the expensive bodies
ord: 36
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
Both orders green: 2 tests and 28 assertions each, one DoorFixture per worker, the second file takes the ready world. In the ready world teamPlaces costs 4.3 s CPU whole and 1.8 s in body, purposeActivity 3.6 and 1.4 s; cold first files 8.7 and 8.5 s. Forward/reverse runs: 12.2/12.7 s CPU, world build and setup 6.6/6.3 s, bodies 3.5/4.6 s. These are two already narrow real boundaries; reading the code revealed no expensive decision matrix, code unchanged. Audit figures 14.0/13.2 s were cold single samples; no comparable quiet factor claimed. Ledger x10/x-threads.tsv updated; reports run.23318.1792856710543.jsonl and run.25267.1792856728768.jsonl.
