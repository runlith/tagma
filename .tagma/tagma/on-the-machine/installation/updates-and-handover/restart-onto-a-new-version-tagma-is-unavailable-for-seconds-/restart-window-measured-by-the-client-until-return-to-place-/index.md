---
id: 01a12699-1673-714b-a6a5-79e7212d752c
title: Restart window measured by the client until return to place, server records the restart by phases
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/boot.ts
  - kind: file
    ref: apps/tagma/server/src/composition/phase.ts
---
The window ends when a human can act again where he stood, not when the server started listening on the address. Its length is measured by the client on its own clocks, and the server records each restart by phases: the record shows whether it fit the ceiling and which phase ate it.

## Why `Listening` and `/health` do not fit

Four short restarts on 2026-10-10 on one machine (one sample each, not a distribution; the first and third applied small migrations):

| Successor start | websocket gap → local door | From door to run-recovery launch |
|---|---|---|
| 12:49:29 | 9.9 s | 17.7 s |
| 13:13:33 | 8.4 s | 3.7 s |
| 15:20:04 | 8.7 s | 5.1 s |
| 15:28:38 | 9.1 s | 3.7 s |

After opening the door `settleFloor` (`composition/boot.ts:20-43`) first reconciles and appends thread rollouts and only then launches run recovery. The moment the surface got the tape's first frame, reloaded and returned the place is recorded nowhere now.

## Two measurements

- **Window** — what is promised to a human. Start: the first client action that got a refusal. End: the client, after a page reload if there was one, opened the same thread with the same draft, got its tape, and the server accepted its action. Measured on the client's clocks: it remembers the start where it survives reload, and after return reports its window length to the server.
- **Server interval** — from the predecessor door closing to the first live-channel frame the successor sent for the place the client resubscribed to. The server knows it itself. Local and remote doors counted separately.

A frame sent before the page reload never proves return; so the budget is checked by the window, and the server interval serves analysis.

## Restart record

The restart owner (`installation/process`) keeps one record per restart: identity (predecessor and successor pid and build), phase moments and windows reported by clients.

Phases:

1. restart accepted;
2. successor prepared;
3. predecessor door closed;
4. predecessor owners closed, data directory released;
5. data directory taken by the successor;
6. stores opened (how many migrations applied);
7. execution host accepted;
8. door answers — local and remote separately;
9. first frame sent;
10. running runs restored.

Phases 1–2 run while the server is alive and never enter the window; phase 10 may run past the window end; phases may overlap. Phase durations never add up to the window.

Launch phases are already measured by `composition/phase.ts`, printing log lines. The record takes the same phases as data; nobody parses log lines. Its phases the predecessor hands to the successor with the ownership handover.

The last record is shown by `tagma status` and the machine-state operation: window, server interval and phases.

## Budget

- **Invariant, true on any machine:** the window never grows with accumulated history — event, message, call and command counts, thread lengths, store size. Thread and project counts enter it only through entity-table operations ([[9631d38c]]). The length of the thread a human stands in never enters it: the frame reads the tape window ([[8d4a4eb8]]).
- **Second goal:** usually under 5, ceiling 10. This is a goal for a human, not a machine property, so no timeout or per-phase budget share follows from one measurement.
- **Waiting is named upfront.** Before leaving, the predecessor knows what the successor will apply (how many migrations and whether a heavy update is declared) and past restart lengths on this machine. If the expected window is over the ceiling, a human sees the expected length and the cause before restarting.
- Exceeding the ceiling in an ordinary restart stays in the record as an excess; it is never renamed into an exception after the fact.

## What the implementer proves

- **Rig.** System test on its own server instance (own root and port): restart by public act with a switched client build, window measured on the test client's clocks from the first refused act to the accepted act in the same thread after return. Two datasets with the same thread the client stands in — with a short history of the rest of the threads and with a long real one (many threads, long rollouts, several graphs). Checked: the window on the second set never exceeds the window on the first past the declared tolerance, and the record holds every server-interval phase.
- **Big old place.** The same rig when the client stands in a big thread: the window no longer than with a small one.
- Browser checks — a separate test with one server process, not part of the wide rig.
- Tests never assert absolute seconds: the implementer takes them off with a separate measurement and cites them as a sample with machine and dataset.
