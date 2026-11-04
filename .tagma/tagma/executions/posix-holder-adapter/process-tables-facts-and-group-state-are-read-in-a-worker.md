---
id: 01a16639-c4fa-74c9-85a8-3a5cda7b2706
title: Process tables, facts and group state are read in a worker
ord: 9
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a1662f-8eba-7ac3-b104-b31e35d3e139
sources:
  - kind: file
    ref: packages/execution-host/src/posix/macos/processes.ts
  - kind: file
    ref: packages/execution-host/src/posix/ProcessServer.ts
  - kind: file
    ref: packages/execution-host/src/posix/ProcessWorker.ts
  - kind: file
    ref: packages/execution-host/src/posix/linux/processes.ts
  - kind: file
    ref: packages/execution-host/src/posix/PosixHolder.ts
  - kind: file
    ref: packages/execution-host/src/holder-client/Link.ts
---
Process tables, process facts and group membership grow with the population and can block unrelated deadlines when read on the logic loop. They are therefore queried through the process-worker protocol on both platforms; a group read does not share the terminal-input thread. Each reader, sampler and holder owns its worker lifetime, using the same replacement mechanism after worker loss.

The process reader remains lazy so an identity-only caller needs no worker. The holder opens its group reader before standing census, so the worker's descriptors and tasks are part of measured standing cost. An asynchronous group query serializes with reap and discards its answer if the holder connection is lost: an answer from another ownership interval must not prove the held work ended. Failed or unreadable group reads remain explicitly unmeasured with their cause recorded.

Single-process identity remains synchronous because it addresses one kernel entry, rather than traversing the machine. The selected platform supplies the worker entry, which is part of the same host bundle as its client.
