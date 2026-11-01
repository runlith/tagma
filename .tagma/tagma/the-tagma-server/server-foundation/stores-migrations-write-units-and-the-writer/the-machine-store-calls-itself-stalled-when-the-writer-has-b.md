---
id: 01a14564-656e-7e40-9f43-ef37c352d5ea
title: The machine store calls itself stalled when the writer has been held past WRITER_STALL_MS with no request, and /health serves that with the process pid
ord: 8
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/http/health.ts
  - kind: file
    ref: apps/tagma/server/src/http/contract/wire/health.ts
  - kind: file
    ref: apps/tagma/server/src/platform/contract/service/store.ts
  - kind: file
    ref: apps/tagma/server/src/platform/store/open.ts
  - kind: file
    ref: apps/tagma/server/src/platform/store/transaction.ts
---
Every store transaction signs the writer with its operation (`HeldFor`), so a stall names the work, e.g. `project.birth`.

The store judges only writer silence as counted by the SQLite package. `WRITER_STALL_MS` must exceed the longest legitimate in-transaction pause outside SQLite by a wide margin: the window kills the server by it, and too short a term would kill a healthy server mid-write.

`/health` carries `stalled`: process pid, database, work, hold time, silence and waiter count. By it the window kills exactly that process. No stall is conveyed as explicit `null`: otherwise a client can't tell a healthy writer from a response that doesn't report its state at all.

Graph mirrors are not judged: their legitimate writes are longer, and a stalled mirror holds one project's write, not the whole program's.
