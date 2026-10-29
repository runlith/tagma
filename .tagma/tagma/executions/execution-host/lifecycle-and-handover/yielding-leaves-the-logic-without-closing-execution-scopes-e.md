---
id: 01a129ab-1d6e-75af-aed2-a657762a0edf
title: "Yielding leaves the logic without closing execution scopes: everything the successor needs is kept until exit"
ord: 6
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/execution-host/src/registry/departure.ts
  - kind: file
    ref: packages/execution-host/src/store/departure.ts
  - kind: symbol
    ref: packages/execution-host/src/Custodian.ts
    symbol: leftBehind
---
Yielding leaves the logic without closing execution scopes: everything the successor needs is kept until exit.

- **After ACTIVATE yielding is irreversible.** The holder activates `bundle.next` as soon as the logic leaves, so steps never refuse: a step failure goes to the log, and the logic leaves anyway. An ACTIVATE refusal of `invalid` or `unsupported` (the holder has nothing to activate) never stops the yield: the next logic starts from the standing bundle. Without `bundle.next` preparation answers `Prepared` without calling PREPARE: a policy- or share-only change never copies the unchanged bundle.
- **Yield can be asked by platform signal** (`YieldRequests`; on POSIX — SIGUSR2): a predecessor-less server lays the candidate and signals the logic by its witness. The logic walks the same road with no client and no custody: preparation checks → ACTIVATE → departure. The signal handler sets the platform layer before the logic writes its witness into registration, and an early request waits in queue until admission: otherwise a signal arriving mid-load would kill the logic by default. Under an accepted yield or a running shutdown the signal does nothing: the logic leaves anyway. Check or activation refusal, no candidate, and admission under fence are written as a line into `yieldRefusalPath(state)`, while admission stays as it was: the server that asked to yield awaits the fact and would otherwise wait forever.
- **A torn channel to the holder (`broken`) is itself a reason to yield.** The logic leaves by the same road with no ACTIVATE and no PREPARE: preparation answers `Prepared` after its checks, and the candidate's permission carries the exit status. A holder that is gone (`gone`) refuses the yield with `HolderLost`: the logic itself then holds the executions and serves them to the end.
- **Yield and shutdown exclude each other**: an accepted yield refuses shutdown and vacate (`AdmissionClosed`), a started shutdown refuses yield (`HostConflict`).
- **Order is the invariant.** Intake (every `ExecutionInput` entry, admission fence, in-flight starts, taken-but-unstarted commands — with the `not-started` reason) → release (record reading closed, the running `shelf.release` finished, no new one starts: otherwise a command that left in the window would leave the holder's table stamped in a way the store rejects after handover) → per execution separately: reading (`Live.stopReading` waits until the pipeline stands on the chunk boundary) → `Interpretation` answers into the input queue → writer (`halt`: the act tail and the queue) → its own `execution_departure` transaction → `record.suspend` → stream ends the record journal never took into execution state → store `handover`. Answers merge after reading stops, otherwise parsing would breed new ones; the parse frontier is taken after the merge.
- **Every execution has its own budget.** A step that misses it never holds the fleet's yield: the remainder is taken as it stands (in-flight act bytes excluded). An unwritten remainder is written as a loss mark; the successor refuses such an execution with `departure-lost` — it is unaccepted, its fds unread.
- **The remainder never vanishes in the window.** A fence or input end after `halt` never drops the queue — it goes into the remainder, and `accepted` agrees with it. An answer with no queue room awaits room and is never lost; at merge it enters the remainder past the input budget. Interrupt echo awaiting unread bytes leaves into the remainder shifted against the read frontier.
- **The logic exits `process.exit` without closing execution scopes.** Their finalizers would seal the record and finish the executions (`retirePty`, `retirePipes`). The store closes with `Connections.handover`: no checkpoint and no `onLost`.
- **The remainder is lifted after taking**: the successor reads the line before assembly and deletes it only having assembled the execution, so an assembly refusal leaves the remainder for the next logic.
- **The old logic's connection custody is ended by the new one.** Departure interrupts connections, and their `ended` never gets written; so at start the logic releases custody whose holder is a same-incarnation connection (it has no connections of its own yet) by the regular Release transition. Same after `kill -9`.
- **The departing logic's admission never opens**: `resume` under an accepted yield's ticket answers `TicketUnknown`, and new calls on connections get `AdmissionClosed`.
