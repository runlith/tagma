---
id: 01a16dee-02e0-76f7-9204-b61c063f8fdc
title: Cheapen the threads-core tests without losing useful contracts
ord: 3
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
45 source threads-core files handled and two unit files added: 11 deletions, 31 changed surviving tests, five kept narrow conformances. Their source cost — 159.7 s CPU; deletions removed 61.9 s of that line. The sum of cold isolated samples of 31 changed files — 158.4 s, incomparable with the source batched measurement; five unchanged files never rerun. Comparable after/ratio and the x10–20 goal stay unverified until the shared quiet run. All changed survivors green individually on seeds 1–3. Fixed the last full-page cursor and the journal stale-carry race; the journal fix passed independent review. Ledger: x10/x-threads.tsv; the remaining 67 files (94.0 s of source line) handed to x-server-rest, its ledger separate.
