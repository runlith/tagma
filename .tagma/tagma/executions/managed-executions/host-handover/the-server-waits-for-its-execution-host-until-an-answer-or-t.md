---
id: 01a14186-f268-756d-960e-2fb0be677c67
title: The server waits for its execution host until an answer or the holder's exit, with no deadline on raise and Welcome
ord: 5
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/host/connection.ts
  - kind: symbol
    ref: apps/tagma/server/src/executions/host/boot.ts
    symbol: raiseHost
---
- **Raise.** The holder is the server's child, so its exit is observable. An empty table and logic that crashed before ready take the holder away with its code, so a broken bundle ends the raise with a fact. While the holder lives, the raise waits for an answer as long as it takes; a silent endpoint, still-previous-build registration (`mismatched`) and a broken handshake are not an answer yet. An answer the server can't read is a verdict at once: the bundle was built for a different wire. After the holder exits, status is asked once more, and only silence yields `Unraised` with how it ended.
- **No deadline on Welcome.** The server's client to its host bounds the handshake with no deadline, and `ExecutionClient` connects under a semaphore with no hold ceiling: on a slow machine loaded logic greets slowly, and a deadline turned that into "answers something this server cannot read" or a break and a raise refusal. The connection is ended by Welcome or a broken connection.
- **With no fact.** Logic alive and hung after accept holds the raise and every request: nothing publishes that hang.
