---
id: 01a131cf-a395-773c-92a8-1ab1325974f4
title: A read abandoned by the caller before the answer takes down its reader lane's process, and neighbouring connections learn of the loss before it frees
ord: 8
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a131c7-7066-7782-84b6-278a389eaa72
sources:
  - kind: file
    ref: packages/sqlite-process/src/connection.ts
  - kind: file
    ref: packages/sqlite-process/src/ProcessPool.ts
---
The child runs a statement synchronously, and nothing can interrupt it from inside: `bun:sqlite` gives no `sqlite3_interrupt`. Without taking the process down, a read abandoned by the caller (a cancelled HTTP request, an interrupted tool, a timeout) would hold the shared lane to the statement's end. The palette cancelling a search on each keystroke thus held lanes for minutes.

So `Run` on a reader lane waits for the answer interruptibly. If the caller left and no answer came, the connection declares loss to itself and through `ProcessChannel.kill` takes the lane process down with SIGKILL. The lane is still leased to that read, so no neighbouring store's statement can run in the process. Neighbouring connections get their loss synchronously, before the lane frees: their readers leave the pools and reopen on the next read in a new process, never sending a statement to the dying one. A neighbour Close caught in flight gets its own failure.

The writer waits for the answer uninterruptibly: taking its process down is losing the store. The choice's cost: spawn and Open of a new reader process per abandoned statement still running, versus unbounded holding of the shared lane.
