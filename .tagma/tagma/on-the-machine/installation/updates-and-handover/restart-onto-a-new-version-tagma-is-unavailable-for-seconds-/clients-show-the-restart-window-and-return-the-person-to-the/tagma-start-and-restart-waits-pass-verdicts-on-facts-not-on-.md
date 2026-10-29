---
id: 01a1415a-db80-7f6b-b559-38f85c98bd35
title: Tagma start and restart waits pass verdicts on facts, not on time expiry
ord: 8
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1414c-313d-7e99-9362-e58366fedb67",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a12699-1673-714b-a6a5-79ebd801f443
  - kind: relates
    to: 01a13cca-54f6-7dc4-93b7-dc63d6920c21
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/wire/Restart.svelte.ts
  - kind: file
    ref: apps/tagma/desktop/src/SurfaceLoader.ts
  - kind: file
    ref: apps/tagma/server/src/installation/process/serverStart.ts
---
Every Tagma server wait at start, restart, and update passes its verdict only on fact, never on time expiry.

**Facts it is decided on:** the server answered (`/health` — its own catalog or someone else's); the start recorded a failure (`startup.status = failed`); the process raised by the waiter has exited; the restart recorded a failure (a `failed` stage); the data catalog is held by nobody and no restart with a live participant is running. While the process is alive and holding the data catalog, or a restart is running with a live predecessor or successor — wait, however long it takes. There is no answer deadline for a request to one's own server: a slow answer is not silence. The poll frequency decides when to ask, nothing more.

**Why.** On 2026-10-15 22:38 the Tagma Dev window showed "didn't start · did not answer" in the middle of an ordinary post-build restart: the old server was closing for 30.3 s, `SERVER_PATIENCE_MS` (20 s) in `SurfaceLoader.served` expired, though the window saw every second that a live process held the catalog. The new server answered ~10 s later. On a slow machine the same restart takes minutes, and any fixed deadline lies there. The operator's decision: operate on facts, events and triggers, not timings.

**Where.**
- Desktop window: `SurfaceLoader.served`/`unanswered`/`watch`/`restarted`, `server.ts` (`reach`, `machineWork`, `askRestart`), `installation.ts` (`installFrom`), `placing.ts` (signature check).
- Application: `Restart.svelte.ts` (`stayed` on a deadline), `RestartNotice.svelte` (silence past the ceiling), `Standing.svelte.ts`.
- CLI: `installation/process/serverStart.ts` (`awaitRestart`), `installation/cli/server.ts` (`restart`), `checkout-builds/cli.ts` (`update`), `release-channel/cli.ts`, `installation/setup/switch.ts`.
- The fact "restart is running / failed / who of the participants is alive" has one owner — the restart record (`installation/process/record.ts`); the window, the application and the CLI read its answer.

**Done when** tests over the real functions show: the catalog is held by a live process, the address is silent past the old 20 s — the wait continues and ends with the server's answer; the process is gone with no answer and the catalog free — the window raises the server, the CLI refuses; a start or restart recorded a failure — a verdict with its cause. Notes [[d6920c21]] and [[9d333245]] and spec [[d801f443]] say the same.
