---
id: 01a129e5-5a45-70dc-9761-4a3957b676b4
title: Census does not count its own probes as standing logic cost
ord: 6
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a129c7-cc4e-72b1-bd45-ffce6245984a
sources:
  - kind: symbol
    ref: packages/execution-host/src/posix/macos/standing.ts
    symbol: readStanding
---
User-process and PTY probes run in parallel; census excludes the actual PIDs of its children from the UID list and accepts only positive PIDs. Census waits for the probes' exit or failure instead of turning machine load into a boot refusal; either output cap interrupts the probe and closes its scope, so an endless producer cannot hold a census open. If spawning the second probe answers EAGAIN while its sibling is running, it is retried once after the sibling's scope closes: the last nproc slot stays available to executions. The logic's and the holder's descriptors are read directly from the kernel fd table before launching globals: neither the global probes' pipes nor a separate observer process's descriptors may become standing logic cost and shrink the promised capacity. `PlatformFacts.standing` calls the passed `observe` exactly once in the same synchronous step, so the accounting owner takes the matching snapshot without yielding to the scheduler.
