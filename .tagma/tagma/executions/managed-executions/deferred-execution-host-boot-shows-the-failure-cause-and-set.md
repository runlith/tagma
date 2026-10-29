---
id: 01a13d58-e5af-7b43-8425-23fcd7a280ad
title: Deferred execution-host boot shows the failure cause and settles the answer to pre-door calls
ord: 21
tags: ["task"]
fields:
  {
    "holder": "tagma:01a155c7-294a-7a5e-89c7-8b8b071d4595",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13d2f-397e-77cc-90c3-6f03bdb21bcd
  - kind: relates
    to: 01a13ca9-dcd2-7d9c-9ba8-d7d2e0867f81
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/assembly.ts
---
Found by the review lens of the executions translation to the Effect style ([[bdb21bcd]]). Both paths arrived with an uncommitted edit of session 01a13c9d on [[e0867f81]]: on HEAD (`d0e4c8a819`) `apps/tagma/server/src/executions/assembly.ts` has no `takenAfter`, the layer either raised the host or failed at build.

**1. Deferred-boot failure dies silently** — `assembly.ts:466-477`.
With `HostOffering.takenAfter` the layer forks `takenAfter → cold road → broughtUp → settled → booted` into its scope with no failure handling and no log. Any failure there (`firstEnable`, `awaitLogic`, `raiseHost`, `custody.ensure`, `placeOverForeign`) or defect ends the fiber, and nobody sees it. `live` (`assembly.ts:317-324`) stays `Unraised` forever with the cause "the host is taken over once this release opens its door": after the door opens the operator is invited to wait for it, there is no host, `booted` (waiter recovery, `cell.follow`, `endings.resume`, disposition) never ran.

**2. Pre-door calls answer WireUnavailable** — `assembly.ts:219, 296` and `packages/executions/src/ExecutionClient.ts` (`session`).
With `takenAfter` the layer services (`custody.guarded()`, terminals, commands, `HostPace`, world spawner) are available before the raised host. `ExecutionClient.session` connects on demand; with no standing host at the address yet, the first call gets `WireUnavailable` (`unreachable`/`absent`), and a managed spawn gets `ManagedCallFailed{ reason: 'unavailable' }`. A repeated call after the door reconnects: `held` resets after the failure. Not verified whether any caller ever reaches executions before `takenAfter` (startup order in `composition/server.ts`/`runtime.ts`) and whether "unavailable" is tolerable there.

**To do:**
- in the deferred-boot fork, a failure is handled by its own condition: `live` gets an honest `HostBoot` with the cause, the log names it; a defect is not hidden;
- find out who calls executions before the door; if any do — wait for boot at the owner (not a retry at the caller) or answer with a typed "host not yet accepted" refusal.

**Done when:** a system test in `composition/testing/executions/hostChange.stest.ts` with a deferred boot whose step fails sees the failure cause in standing, not "wait for the door"; a pre-door call either waits or gets the named refusal; rule [[ea465bed]] with no new violations.

**Done (3bbd3f20a8).** Item 1 already stands: a deferred-accept failure writes its cause into standing and the log. Item 2 was found on user 0.1.5 (update over 0.1.1): the first 3–5 s after the door, terminal reads refused `terminal-host-unavailable-mismatched`. The host client gives the `awaiting(ready)` view, where every call first waits for `ready`. `HostConnection.port` is that view: in a live attempt it waits for the end of acceptance (`admitted`, after `settled`, before the load work). Acceptance itself, custody and machine diagnostics go through `HostConnection.direct` with no waiting. Start and cancel go through custody as before and also wait for the end of the load work (`takenOver`). Agent worlds, the agent-execution port, `end_residual` and `end_process` go through `port` and wait the same way. The waiting host state names its own `HostBoot` `Awaited`, not "host is not up".

Incidentally: `/startup` answered 500 when the restart record held `heavy: undefined` (`Schema.optionalKey` doesn't encode a key with `undefined`). The user saw the "Tagma is not answering" bar for 6 hours with a working server. Now `heavy` is `Schema.optional`, and a browser window that didn't ask for a restart closes the bar when `/startup` answers with an error instead of staying silent.

Proof: in `hostChange.stest.ts` a read through `Terminals` and through `HostManagement.connection.port` before the door waits and answers `running` after it. Without the fix it fails, with it 6 of 6. Acceptance broken after the door names the cause in standing and answers waiting calls with a refusal. `tagma:transition` from 0.1.5 and 0.1.2 onto the tree: terminals `running` in all three worlds after the update, pty record with no holes, reads during acceptance waited 1.7–3.3 s with no refusal. Before the fix the "fresh app next to server 0.1.2" world refused `mismatched`.

Not proven: window steps in `tagma:transition` for releases from 0.1.2 — [[55712a25|separate task]]. Released 0.1.0–0.1.5 themselves still refuse in those seconds: their code doesn't change.
