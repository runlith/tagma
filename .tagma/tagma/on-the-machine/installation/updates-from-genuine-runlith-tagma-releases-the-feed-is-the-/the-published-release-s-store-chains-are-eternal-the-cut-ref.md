---
id: 01a17f29-c3c6-7849-ae9c-7c5668c19bd9
title: "\"The published release's store chains are eternal: the cut refuses without them, no folding required, 0.1.0 data translates forward\""
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17f1d-0712-7796-8a03-a68232e94329",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a17f29-c340-781d-b849-69493bb9e31f
---
Replace the `machine-store` folding requirement with a check: every migration and step of the newest published release is in the cut. Prove with an itest that the machine database and the host database with a 0.1.0 ledger open with the current chains to the head and keep their rows.
