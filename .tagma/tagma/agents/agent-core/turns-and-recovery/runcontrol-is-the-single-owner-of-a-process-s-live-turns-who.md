---
id: 01a15f5d-b986-7d27-807b-df1aae0ca064
title: "RunControl is the single owner of a process's live turns: who holds them, which stop stands on them, and whom to tell about the interrupt"
ord: 13
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a15eeb-6b48-7ca8-9c93-24d47031f1f3
sources:
  - kind: file
    ref: packages/agent/src/thread/run/RunBeater.ts
  - kind: file
    ref: packages/agent/src/thread/run/RunControl.ts
---
`RunControl` is the process's one place where the core asks about a live turn: which turns the process drives (the host's `onDriving` sees their count), which transport holds a turn, what stop intention stands on it, and whom to tell about the interrupt. Heartbeat (`RunBeater`), reaper, `RunExecution`, scheduler, and `RunLifecycle` read it from here, not from transport `holds` or their own collections, so their "who holds the turn" answers never diverge.

A turn is driven from the moment the core hands it over or takes it (`launching`, `drive`) until the end written by `RunLifecycle` (`ended`), or until the first heartbeat where no transport holds it and it is not being handed over. A turn being handed over counts as held before any transport takes it: otherwise the heartbeat would not beat it, and another process would take it as abandoned. `launchable` is a synchronous projection of the same state: the run is still driven and stands under no stop. The transport reads it in the prompt-issuing act, without a separate database read that a stop could slip between and the issuance.

`interrupt` goes to the transport holding the turn. When nobody holds the turn, the message goes only to the transport the thread is bound to — not to all: one transport's failure does not hide the rest and does not block an orphaned turn's end. A transport not registered with the process answers `no-turn`.

The native transport holds its turns in `RunExecution` collections (launch, work, a stopped start): that is its own state, and it surfaces outward only through its `holds`.
