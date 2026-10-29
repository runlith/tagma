---
id: 01a12af7-16d2-7390-bf01-29a4f54c554d
title: An undecided custody transition resolves from the store before the next change
ord: 9
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a12aeb-bd45-79a7-80bf-c77e62381250
sources:
  - kind: symbol
    ref: packages/execution-host/src/Custodian.ts
    symbol: make
---
A lost custody-transition answer proves neither commit nor rollback, so authorization stays closed until the fact is read. Before the next change the `Custodian` reads the standing from the store under semaphore by the undecided transition's key; if the read fails, the undecidedness stands and the failure returns to the caller. A new request passes the usual revision and key-fingerprint checks against the recovered fact: a lost answer never permits reissuing an epoch or reusing the key for another request.
