---
id: 01a10b59-f0e7-7a36-96f4-b1cd5c2a4c31
title: A thread's activity is decided by its run, not by its CLI process's life
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/harness/externalSession.ts
  - kind: file
    ref: apps/tagma/server/src/threads/list/select.ts
  - kind: file
    ref: apps/tagma/server/src/threads/list/summary.ts
  - kind: file
    ref: apps/tagma/server/src/threads/store/directory.ts
  - kind: file
    ref: apps/tagma/server/src/threads/store/harnessFacet.ts
  - kind: file
    ref: packages/agent/src/thread/state.ts
---
A CLI process stays alive between runs, so its session is no source of `life`, the current run, or the run result. Native, `acp` and `terminal` life is derived by one `runSignals` (`packages/agent/src/thread/state.ts`) from the run row and `native_thread.updated_at`: from it come `RunStatus`, `CurrentRun` (`ThreadRuns.current`, directory, `list_agents`, stall), the list row's `life` and the `stalled` threshold. The threshold is `stallAfterMs(callEnvelopeMs)` (`agent/callProgress.ts`): `max(2 × AGENT_IDLE_MS, callEnvelopeMs)`, where `callEnvelopeMs` is the row's own capability (native — `CALL_ENVELOPE_MS`, `acp` — the profile field; Devin and terminal have `null` — the transport does not judge stall because its tools' envelope is unproved); "movement" is `native_thread.updated_at`, advanced by every write into the thread journal and by run start and end. The `state: stalled` filter takes the same threshold as a scalar: the virtual `native_thread.call_envelope_ms` column is derived by SQLite from `capabilities`, the `STALL_FLOOR_MS` floor is added in `stalledKernelThread`, so the scalar has no writer. The thread surface (terminal or chat) picks the `screen` capability (`true` at a terminal); the terminal opens as before, and the `threads.terminalChat` setting opens a chat over the journal. SQL selections take "running" and "asking" from `thread_run` (`status`, `progress.stage`) and the `native_thread.pending_interaction` question slot, not from the facet.

A terminal thread reads through the same projections: its run is a core run, so `RunStatus`, `CurrentRun`, `life`, `activeRun`, `outcome`, ask, `state: running` and keep-warm come from `thread_run` and `pending_interaction`, with no separate road by transport. A live CLI with no run is `idle`; its process shows in the row and holds Stop.

The live-process fact stays in the harness facet for managing its resources: archive picks held sessions (`heldSessions` — running runs and `liveProcesses` on the unfinished-sessions partial index) and releases each via `ThreadReleasing` → the core's `Transport.resource.release`; subtree deletion and handing the thread to another transport do the same release. An unrecognized release is a typed refusal, and the thread is archived or deleted only with confirmed release.
