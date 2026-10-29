---
id: 01a16639-c4fa-74c9-85a8-3a5cda7b2706
title: "macOS facts, scans, and the process table are read in a worker: the host main loop never waits on the kernel for reads that grow with the process count"
ord: 9
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a1662f-8eba-7ac3-b104-b31e35d3e139
sources:
  - kind: file
    ref: packages/execution-host/src/posix/macos/processes.ts
  - kind: file
    ref: packages/execution-host/src/posix/processes.worker.ts
  - kind: file
    ref: packages/execution-host/src/posix/ProcessWorker.ts
---
Reading every process's arguments, executable, and directory (`KERN_PROCARGS2`, `proc_pidpath`, `proc_pidinfo`) walks other processes' memory, and its time grows with their number and machine load: under two release builds one such synchronous call held the host main loop for 3.2 s. While the loop stands still, its own effects' deadlines — e.g. the 2-second segment-write deadline that keeps shutdown from hanging on a stuck disk — fire on the loop blockage, not on the disk, and tear down others' live executions.

So `facts`, `scan`, and `table` go to a dedicated worker, and `ProcessReader` answers them asynchronously; the port for callers does not change. One worker serves all native process reading: the same entry also answers load sampling (`openUsage`), but the process reader and the sampler each hold their own instance, so fact reading never waits on sampling. The reader raises the worker lazily, at the first read that needs it — a process reading only `identity` (the server) holds no worker — and replaces a lost worker with a new one at the next read.

`identity` stays on the loop: it is one `KERN_PROC_PID` `sysctl` over one entry, single microseconds on any table, and the port declares it synchronous: ordinary code calls it with no effect.

The worker entry is part of the host bundle with the `sampler` role; the build finds it via `new URL('./processes.worker.ts', import.meta.url)` next to the client, so the client and the entry live in one directory.
