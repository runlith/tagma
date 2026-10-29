---
id: 01a12699-1673-714b-a6a5-79ea6417e7fa
title: Until ready, the server answers with its start state, and `/health` means "may work"
ord: 4
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/desktop/src/waitingPage.ts
  - kind: file
    ref: apps/tagma/server/src/http/contract/wire/health.ts
---
Before readiness the starting server answers with its start state on its own address, and `/health` means "may work". A starting server answers on its address before opening the stores: it names the start phase, the step of the announced ones, and a failure if one happened. Ordinary operations get an explicit "starting" refusal until ready, while `/health` keeps meaning the server may be worked with.

## Why

In an ordinary restart the window is short, and the client needs only its own count. The start state matters in three cases: a long update announced in advance, a cold application start (today several seconds of a silent address), and a failed start that otherwise looks like endless waiting.

## What stands now

- The HTTP door requires an assembled runtime, and `Health` always answers `ok: true` and already carries the open schema and session identity (`http/contract/wire/health.ts:7-24`). Raising it before the stores open is not a row reorder.
- Three waiters rely on the `/health` answer: surface reloads the page as soon as it returns (`apps/tagma/app` — `Standing.svelte.ts:222-238`), the CLI counts the server as raised (`installation/process/serverStart.ts:25-88`), the desktop window loads surface. A 200 before readiness would break all three.
- The desktop window on a silent address shows the waiting page with a log path and knows no phase (`desktop/src/waitingPage.ts:15-30`).
- The remote door admits a device by reading the machine store (`composition/http/remote.ts:86-93,146-170`), so before the stores open it can admit nobody.

## What is built

- **One handler of the same process and the same port.** After taking the data catalog and before opening the stores, the server opens the local door with the start handler: it returns the start state and the surface static shell, and answers any operation with a "starting" refusal. Once the runtime is assembled, the handler is replaced with the full one. No second server and no second port.
- **The start state** is a phase from the restart record, a `k of n` step for announced steps (migrations), the start moment, the expected length if announced, and a failure with phase and cause. No percentage is invented: only what has an announced step count is counted.
- **`/health` does not change meaning:** until ready it answers as not ready, and none of the three waiters takes a starting server for a working one.
- **The remote door** does not open before the stores open. The remote client shows its own restart state and shared count; it will see the phase once the door admits it.

## Failed start

Two outcomes, and seen differently:

- **A failure the server caught** (the store did not open, a migration refused, the port busy): the cause and phase are recorded in the start state in the data catalog next to the restart record, then the process exits.
- **The process is gone** (killed, fell): the last recorded phase without a cause stays in the data catalog.

Who reads what:

- **`tagma status` and the desktop window** read the state from the data catalog when no process is left: they name the phase and cause if recorded. The desktop main process hands it to the page.
- **The browser tab and the bound device** do not see the file. They show the last phase they managed to get and that the server has been silent past the ceiling — with no cause, naming where to read it.

There is no process answering for a dead server: the server's life owner stays the same.

## How it is arranged

- The start state belongs to `installation/process` — the same owner that keeps the restart record; one record, not two.
- The store reports opening progress through a port in `platform/contract/service` (migration `k of n` started, opened). Composition binds the port to the start owner; `platform` knows neither HTTP nor installation.
- The start handler is part of the HTTP door: it can take an early handler and replace it with the full one on the live listener.
- No progress parsing of `serve.log` is done by server or clients.

## What the implementer proves

- A server instance started over a store with waiting migrations answers with the start state with a step before the first one ends, and answers an operation with a "starting" refusal.
- `/health` does not answer as ready before readiness; after readiness the same listener answers with the full handler.
- A store-open failure leaves the failed-start state with phase and cause in the data catalog, and `tagma status` names it.
- An instance killed mid-start leaves the last phase without a cause.
