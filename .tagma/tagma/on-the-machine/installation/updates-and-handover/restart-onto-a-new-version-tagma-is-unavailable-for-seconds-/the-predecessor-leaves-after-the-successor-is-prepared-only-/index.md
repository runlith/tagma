---
id: 01a12699-1673-714b-a6a5-79e89b246531
title: The predecessor leaves after the successor is prepared; only ownership handover stays between doors
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/server.ts
  - kind: file
    ref: apps/tagma/server/src/executions/host/offer.ts
  - kind: file
    ref: apps/tagma/server/src/installation/process/succession.ts
---
The predecessor stops answering only once the successor has done everything that does not need the data catalog. Between one door closing and the other opening, only ownership handover remains: close the owners, release the catalog, open the stores, take the execution host, start answering.

## What stands now

- **The handshake promises nothing.** The successor reports `STANDING_BY` after seeing the predecessor's lock — before reading the installation and opening the store (`installation/process/succession.ts:220-231`). The predecessor leaves after that (`succession.ts:68-89`). A migration, runtime assembly, or bind failure leaves the machine with no server; `SuccessorFailed` covers only refusal before that message.
- **Only program loading runs in parallel**, about 1.9 s. After that the successor waits for the data catalog, polling the lock (`succession.ts:188-206`).
- **`createRuntime` sits entirely inside the window**: 5.4–7.1 s across four samples. It includes copying and verifying the execution host bundle with the host replaced afterwards, even an idle one: the digest is compared after copying (`executions/host/offer.ts:59-107`).
- **App closing is 2.0 s of a 3.7 s exit**: the stdio transport waits up to 2000 ms after EOF, then SIGTERM (`packages/mcp/src/sdk.ts:190-202,262-275`).
- **After the door opens**, run recovery waits for reconciliation and export of thread rollouts (`composition/boot.ts:26-34`), and then `formStanding` walks project rollout files (`threads/journal/rolloutForming.ts:93-122`).
- **The remote door** opens asynchronously: its listener waits for Tailscale setup and origin sandbox checks (`remote/reach.ts:111-127`, `remote/tailscale/serve.ts:68-132`; order explained in [[7747ed00]]). In one sample it lagged the local door by 18.5 s.

## Restart states

1. **Successor prepared** — the predecessor still answers. The successor has loaded the program, checked parts of its installation, and prepared the execution host bundle in its own catalog. The predecessor, which holds the store, has read the new installation's migration chain and named what will apply: the number of migrations and whether the update declares work outside the migration law. Refusal at this stage leaves the predecessor serving, as `SuccessorFailed` does today.
2. **Ownership handed over** — the predecessor closed the door, the run owners, the graphs and the runtime, released the data catalog, and reported this to the successor over the same IPC; there is no lock polling on this road.
3. **Server answers** — the successor opened the stores, took the execution host, assembled serving, and opened the doors.
4. **Place returned** — the first frame sent, running runs recovered.

## What leaves the gap between doors

- **Execution host bundle.** The digest is compared before copying; a matching bundle is neither copied nor verified again. A changed one is prepared at stage 1. A host with a different digest changes between doors without finishing executions: preparation at stage 1, handover as the predecessor's last act at stage 2, takeover at stage 3 ([[d86d6647]]).
- **App closing.** The app process learns about closing from the transport owner and exits without a grace wait; the wait stays as insurance for one that did not exit.
- **Lock polling** — replaced by the handover message.
- **Post-door work that grows with history.** Recovery of running runs starts first and reads only what those runs need. Rollout reconciliation goes per thread: right after start — only threads marked with an unfinished write, the rest — when they are opened, as journal lane opening already does ([[df760b9f]]). No walk over all threads and all rollout files after start.
- **The remote door** waits for neither run recovery nor rollout reconciliation. Its own external steps — Tailscale setup, origin and sandbox checks — keep their order and count separately in the restart record; its refusal or delay does not hold the local door.

What cannot start before the handover stays in the gap: the database writer, journal writers, the second app process over the same app data, execution host custody, the port.

## Predecessor and successor are different builds

Two builds hand the place over: the predecessor — the old one, the successor — the new one. The handover protocol is the only thing in a restart that both must understand alike.

- **First enablement.** The operator's server is a build with the old handshake: it leaves on `STANDING_BY`, names no migrations of the new installation, and reports no handover. The new-build successor still takes its place from it: it does all stage-1 preparation before `STANDING_BY`, and waits for the data catalog by polling the lock. This road is the only thing left of the old handshake, and it stays forever: release 0.1.0 with the old handshake was issued to testers ([[1c89545b]]).
- **After that,** starting with the first build issued to anyone else, the handover protocol changes only so that a new build takes its place from the previously issued one.

In the first enablement the leaving side is the old program: it closes the old way, and the window shows the old client. The person sees the fully new window from the second update.

## Failure

- **Before the handover** — a typed refusal, the predecessor keeps answering, the person sees the cause.
- **After the handover** — the start is recorded as failed, with phase and cause, and an attempt that never reached the door is rolled back by its own release: databases — to their copies taken whole on entering the attempt, `current` — to the previous release ([[1c89545b]]). Who sees what then is decided by [[6417e7fa]]; there is no endless "restarting" anywhere.

No listening socket is handed between processes: it would not carry accepted websockets and requests anyway, and a short break with correct reconnect is cheaper.

## What the implementer proves

- A successor that refused at stage 1 does not stop the predecessor: it answers the next operation.
- A successor failure after the handover produces a readable failed-start state with a phase.
- With a matching digest the host bundle is not replaced, and executions running in it keep the same identity after restart.
- On a set with a long history, recovery of a running run starts no later than on a short one, and after start no rollout file of a thread nobody opened and with no unfinished-write mark is read.
- A remote door refusal does not delay the local one.
- A successor of the current build takes its place from the predecessor of the build the operator's server runs: a run on one's own instance ends with open doors and a restart record.
