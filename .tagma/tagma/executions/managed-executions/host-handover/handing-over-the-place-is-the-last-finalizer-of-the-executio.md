---
id: 01a12a12-746b-7bd5-8200-44fc11b2a755
title: Handing over the place is the last finalizer of the executions layer before the host client closes, armed by preparation
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/host/departure.ts
  - kind: symbol
    ref: apps/tagma/server/src/executions/host/custody.ts
    symbol: makeTerminalHostCustody
  - kind: symbol
    ref: apps/tagma/server/src/executions/assembly.ts
    symbol: executionsLayer
---
- **Arming.** `SuccessionSteps.prepare` after `STANDING_BY` asks the host to prepare the candidate only if a candidate stands and the host answers. No candidate — nothing to hand over; the host isn't running — the successor itself puts the candidate in place and raises the holder. A candidate whose manifest this build can't read (a part role it doesn't know) also stands: the host judges it, and a host refusal cancels the restart. Read as absent, it would pass preparation silently: the predecessor leaves, the logic rejects the candidate at handover on signal, and the new server stays with no host.
- **Order.** The departure finalizer registers after the host client in the executions scope, so floor consumers close before departure and the client closes afterward. Without a prepared handover, this finalizer releases the floor's remembered custody and awaits the host's answer before closing the client: socket close alone does not prove the host has settled the disconnect, and the next server can arrive while custody still names its predecessor. An unreachable or refused release is reported and left for disconnect settlement. The client owns a separate scope for its lazily opened connections: attaching them directly to the executions scope would register their closes after departure, closing the wire before quiesce and making its reconnect fork an already-closed scope. After Yield nobody in the predecessor talks to the host, and the client is bound to the predecessor's digest and won't connect to the new logic.
- **EOF after Yield settles the fact.** The logic closes connections and drops the endpoint as soon as it accepts the ticket, and the `Yielding` answer may never arrive. Then the predecessor waits for a fact: another witness of the logic in registration is a handover, since a logic records it only after its load ([[c8a4efca]]); a repeated Yield with the same ticket answers `Yielding` (an accepted handover) or a refusal — failure; a free writer claim means the holder left, and that is a failure; so is the load refusal of the candidate's digest beside its boot entry ([[c8a4efca]]): the new logic fell before ready, and the predecessor puts its boot input back, since an entry-only change would otherwise keep the holder raising the standing digest on the failing entry. Before a failure, registration is read once more: a witness appearing at that very moment is a handover, and the old boot entry doesn't land under the new logic. An unread claim is no fact: it is asked again. The endpoint is silent while the claim is held — the logic is leaving, the next one is rising: wait.
- **Failure after quiesce** is any answer but `Yielding`, and EOF followed by a refusal or a departed holder. The predecessor returns the previous boot file (it holds a copy since promote) and asks `resume(ticket)`. Otherwise the ticket would stand forever and refuse every launch, and the same-build host would read someone else's boot entry. The failure itself is only written to the log: the successor, seeing live other-build logic in registration, asks it to yield by signal ([[ce39be5f]]).
