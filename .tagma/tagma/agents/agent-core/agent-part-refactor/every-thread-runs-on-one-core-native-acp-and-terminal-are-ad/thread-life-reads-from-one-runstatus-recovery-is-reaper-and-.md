---
id: 01a11c9a-6edb-7ed8-b517-60b1570382ca
title: Thread life reads from one RunStatus, recovery is reaper and adopt, act cost never grows with thread count
ord: 5
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/serving.ts
  - kind: file
    ref: apps/tagma/server/src/threads/list/select.ts
  - kind: file
    ref: apps/tagma/server/src/threads/store/directory.ts
---
Goal:
- A thread's life reads from one `RunStatus` ([[9f3bb3f9]]) and the columns it reads itself.
- Recovery after a restart is one core reaper and the adapter's `adopt`.
- An act, read, and tick cost scales with what it touches, not with thread and session counts ([[2393aff1]], [[fe83acfa]]).

## One life reading

**The single derivation is `runStatusOf`.** It reads:
- the thread row;
- the `running` run (`status`, `progress.stage`, `heartbeatAt`, `handedOverAt`);
- the run's open `Questions`;
- inbox receipts;
- the ending.

After root cuts 1–3 these rows exist for every thread, so the derivation never branches on transport.

**Consumers take the answer or an owner projection** ([[51c66cb6]]):
- `ThreadRuns.current` (collaboration, `list_agents`) yields `CurrentRun` as a `RunStatus` projection, with `stalledSince` from `runSignals`. `collaboration/native/current.ts` and `withExternalRuns.running` go away.
- `store/directory.ts` orders by run and question columns and yields rows with `RunStatus`. `stalledSince: null` goes away even for native.
- `list/summary.ts` (`summaryOf`, `moveOf`, `askOf`) takes `life`, question, and ends from `RunStatus`. Branches on `terminalSession` and facet go away.
- The `list/select.ts` SQL selections — "running", "asking", "ended and unseen" — read `thread_run.status`, `progress.stage`, open questions, and `outcomeRunOf`. `activeSessions`, `heldSessions`, `asking`, and `endedUnseen` lose the `json_extract`-on-facet branch. The subtree-resource-holder selection for archive takes adapter resources from their indexed column.
- The presence feed and snapshot carry `RunStatus` ([[c3436715]]). The app never derives life: `rowLife.ts` and `harnessAttention` go away ([[0f8d8726]]).
- `withExternalThreads.told` never reads a facet per entry (`threads/harness/collaboration.ts:135-140`, once per ancestor on `lineage`): capabilities are the row snapshot.
- `read_statuses` and `read_endings` serve every thread. Classification and ends read in one query per page, not `projectOf`, `sessionOf`, and `endings` per thread (`threadEvidence.ts:131-145,233-248`).
- A thread entry's publish status, work-time accounting, and keep-warm come from runs on every thread. The process branches of the terminal (`store/sessions.ts:113-120`, `workingSessions`) go away.

## Act cost

- The adapter is found by the binding in the thread row the act already reads. No per-act facet reads. Today `contribution.ts` and `SessionTransports` read the facet on every call, `answer` twice.
- A hook event is one server call reading the thread row and the adapter row by id.
- An adapter report is one write plan in its entry.

## Beats and life evidence

- **Run lease.** One core beater per owner: on each tick it asks every adapter for `holds` and writes one entry for all held runs (`RunLifecycle.beat(runIds)`), as `RunExecution` does for native today.
- **Resource lease.** One entry per adapter and owner per tick, by the adapter row's indexed column. No JSON facet rewrite. Today every live `acp` and `terminal` session, idling included, rewrites its facet every 5 s (`protocol/process.ts:220-236`, `sessions/drive.ts:523-536`).
- **Machine wake.** `AwakePolicy` takes one number — the runs going here across all adapters. The two drivers' `onWorking` counters and `SessionTransports` go away.
- **End wait.** `stop` awaits the execution's end event; there are no per-thread timer polls.

## Recovery

- The core reaper picks running runs with a stale owner in batches (`recoveryBatch`) by `status` and owner index and decides `adopt`, `cut`, or `reap` by the [[7e9130bd]] table. `adopt` calls the binding's adapter.
- An adapter resource whose run a dead owner held is raised only by that run's `adopt`. A runless resource rises lazily, on the next `launch`, and its lease left with the dead owner moves to the new one at that rise.
- Every standing resource's execution end is watched by the adapter as an execution-host event (`TransportResource.watch`), as `discharge.decided` does today. Behind it stands one wait per resource with a long host poll (`executions/terminals/endings.ts`): the adapter holds no timer, and the price is one fiber per resource. On start the adapter reconciles its standing resources against live host executions with one query, so the row never shows a process that is gone. The `json_extract(facet, '$.transport')` scan over all rows (`store/sessions.ts:282-297`) and the `serving.ts` forever loop repeating it every 15 s go away.
- The run lease and the resource lease are held by one `ThreadOwner.id` owner ([[2121a95f]]), so the reaper and resource recovery never see one turn under two different owners.
- Recovery cost scales with running runs and standing resources, not thread count.

## Idle-thread adapter work

An adapter holds no timers on a runless thread except the `acp` idle timer below, and on a thread with a run only while a word awaits it or a read deadline runs ([[a621fbb3]]). Terminal-CLI metadata reads happen on turn boundaries, not by a 5 s per-session poll (`metadata/harnessMetadata.ts`, `METADATA_CADENCE`). A hook awaiting a question answer awaits the question event instead of polling `permissionOutcome` on a timer (`hooks/dispatch.ts:445-461`).

## Idling processes

Today an `acp` process lives between turns with no deadline: a hundred idling threads hold a hundred processes, each with its full protocol-row link in server memory. The operator decision covers `acp` only:
- The adapter ends a process on a timer once one hour passes since the process's last activity. Activity is a word to the thread and any agent frame, including its background work.
- A process with background work still going never ends. The Claude runner reports such work in its row.
- The next word raises the process and continues the same vendor session via `session/resume` or `session/load`, as after a process death.

The idle policy never touches a terminal process: the operator sees its screen, scroll, and half-typed input, and a person started an adopted CLI. Only Stop with `interrupt: resource`, archive, delete, and a transport change end it. So a hundred idling terminal threads hold a hundred processes — those are the operator's terminal processes, and the "cost never grows with thread count" goal covers the server's work over them: beats, reads, recovery.

## Acceptance criteria

The performer proves it with an integration test on minimal sizes that tell constant from linear growth apart: e.g. 10 and 40 idling threads per adapter and 2 running. Calls, rows read, and writes are counted:
- one act on one thread and one evidence tick are constant in thread count;
- a list page and `statuses` scale with the page ([[68659e3b]]);
- a recovery pass scales with running runs and standing resources;
- standing-resource watching is one fiber per resource with no separate write per idling thread per tick. Resource lease is one batched UPDATE per adapter and owner; the resource rows it extends are the lease's admissible price, not per-thread work (operator decision).

More:
- `rg`: no `json_extract` on facet, no `terminalFacet`, `terminalSession`, `harnessAttention` in the life reads.
- Idle test (fake clock):
  - an `acp` process with no activity for one hour ends; the next word raises it, continues the vendor session, and the feed has no break;
  - an agent-background-work frame restarts the hour;
  - a process with running background work never ends even after the hour;
  - a terminal process is never freed by the policy.
- Wake test: the `AwakePolicy` number equals the running runs of all adapters.
- `list_agents` shows stall on native, `acp`, and `terminal` by one rule.

## Decided by the operator

An idling `acp` process ends on a timer one hour after its last activity, background work included. A process with background work still going never ends. The next word raises the process with a session resume.
