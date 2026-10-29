---
id: 01a128d2-01c8-7498-9f69-522b7f126a5b
title: ProcessWitness keeps birth in OS units, and birth order belongs to ProcessReader
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/execution-host/src/posix/macos/birth.ts
  - kind: file
    ref: packages/execution-host/src/posix/macos/evidence.ts
  - kind: file
    ref: packages/execution-host/src/ProcessReader.ts
---
Birth is opaque outside the adapter: recomputing it under different owners diverges on clock skew and can hand a reused pid to someone else's process. The wire compares the pid/birth pair, while ProcessReader decides birth order and accounting-interval membership; an unrecognized birth answers Unreadable and proves neither kinship, currentness nor birth inside the interval. The server gets the current process already chosen by the host. macOS process and socket lines are taken only between matching native witnesses before and after ps or lsof; both reads are a native batch of the needed population, so someone else's replacement never gets the old process's facts, and a narrow question never re-reads the whole machine.
