---
id: 01a11318-7f46-75dd-99fa-e5c98d9252a8
title: "A connection unclosed past its deadline takes its process down: store closing is bounded even behind a hung statement"
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/sqlite-process/src/connection.ts
  - kind: file
    ref: packages/sqlite-process/src/ProcessPool.ts
---
Close queues in the child process behind a still-running statement, and waiting on the Close answer is uninterruptible, so a timeout around it would not fire. The finalizer waits for the Close answer no longer than the deadline, then wakes its waiters and lets the channel go through `retire`. That sends its own writer SIGKILL. A shared reader process is taken down only when no foreign connections remain in it; otherwise a neighbouring store's statement would be lost. The process exit is also awaited with a time bound. The store owner may call `Connections.retire` before its fibers' finalizers: the SQL owner closes admission, wakes current waits and takes down only its own connections. With a shared reader, closing its own handle queues in the process, while foreign connections stay alive. WAL keeps committed even under SIGKILL.
