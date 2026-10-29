---
id: 01a1795c-fdf1-7166-80f2-ac36c9d66811
title: Descriptor measurement in holder contracts reads the kernel fd table and spawns no processes
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/execution-host/src/composition/testing/posix.ts
---
The "a refused launch leaves no logic descriptors" contract compares the test process's fd count before and after. A measurement that spawns children itself (census `readStanding` with `ps` and `lsof`) changes what it measures. On macOS 2026-10-26, during the first such census, a copy of fd 2 (stderr) appeared in the process and stayed open; whether the runtime or the Effect platform opens it is not established. Then "after" exceeds "before" by one fd, unless census already ran earlier in the same worker. Hence a red test that depends on file order. So the contracts adapter reads both counts directly (the platform library's `descriptors`, `proc_pidinfo`), with no census.
