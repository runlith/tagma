---
id: 01a16e1a-733d-7b36-a351-3094a6950a0e
title: In-process SQLite hosting waits on a lock asynchronously and cannot do what a separate process gives
ord: 13
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/sqlite-process/src/inline.ts
---
`inlineHosting` runs the same channel protocol as the child but in the caller's process; test worlds use it by default (`testing/pool.ts`), the product stays on `childHosting`. A test world takes the child instead when the run says so: `RUNLITH_SQLITE_HOSTING=child` (set by `check:change` whenever a non-test file of `packages/sqlite-process` changed), or `RUNLITH_TEST_SEED` selecting its worker (about one in four). A test green in-process and red on child is a variant mismatch to fix, with its case added to the conformance suite (`hosting.itest.ts`).

`busy_timeout` in-process is 0, and BUSY on `Run` and `Open` is retried with a timer to the connection's same deadline. Synchronous `bun:sqlite` waiting would stop the event loop while another connection of the same process holds `BEGIN IMMEDIATE` through `await`: the holder cannot reach COMMIT, and the waiter gets BUSY only on the deadline. Queue time and whole-wait time land in `queueMs`/`execMs`, as with the child.

What in-process lacks: a statement runs synchronously on the caller's loop, so an abandoned read, a Close deadline and neighbouring stores wait for its end; `kill` closes databases cleanly rather than with SIGKILL, so the last connection's WAL may be written into the database; no child accounting. Tests whose subject is these properties (reader lane takedown, store isolation, slot handover, process loss) go on `childHosting`.
