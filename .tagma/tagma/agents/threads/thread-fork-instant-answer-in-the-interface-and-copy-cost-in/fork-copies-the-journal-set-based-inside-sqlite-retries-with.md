---
id: 01a146a4-3507-7e7d-a582-a7db1020c14d
title: Fork copies the journal set-based inside SQLite, retries without starvation, and is visible in telemetry
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a146a4-8f34-7d39-a6df-4e6816c7a2b0",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/journal/log.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadBranch.ts
---
Forking a thread (the operator's `branch_thread`, the agent's `fork_thread`, spawn with `fork`) goes through `ThreadBranch.fork` and currently costs O(record count) requests: measured in the parent [[467f23ab]] — 12 s on a 7.8k-record / 34 MB thread, of which 8.3 s is row-by-row `journal.append` (`apps/tagma/server/src/threads/journal/log.ts`: an event INSERT with a position subselect, an `native_thread.updated_at` UPDATE, a `thread_conversation` INSERT, conversation-index and FTS inserts, moving a row into the rollout) inside one record holding the machine writer.

Do:
- **Copy without a row-by-row pass through JS.** Transcript records, their events, history, conversation index, and other child projections are written with a few set-based requests inside the SQLite process; the request count does not depend on the record count. JS parses and writes only what the fork changes: closing unclosed calls (`sealOpenCalls`/`sealBranchHistory`), the "before turn" cut (`cutBefore`, `forkCut` by turns), dropping `system-prompt` on agent change. The core (`packages/agent`) stays without SQL knowledge: what is needed is declared as a storage port and implemented at the SQLite storage and at the in-memory conformance storage.
- **Child rollout** is no longer written with 7k moved rows in the request answer; the [[2b40d171]] invariant and the rollout's writer catch-up hold.
- **Retry without starvation.** The `prepare`/`bear` retry prepares inside its own write-unit, as [[59b927cd]] does for transitions: a continuously writing source no longer starves the fork into the "kept moving… nothing was born" refusal.
- **Telemetry.** The invocation layer names each operation's span by its id itself (one place for all operations, not each body); `ThreadBranch.fork` gets a span with its attributes (records, bytes). Update the judged-units section in `.agents/skills/performance/SKILL.md` if it stops or starts being true.

Proof:
- the existing conformance sets for fork, rewind, spawn, and `branch_thread` pass without changing their expectations: the child gets the same transcript, history, fold, rewind points, attachments, and tool outputs, and its replicas are found by `search_threads`;
- a contract test: a fork of a continuously writing source is born;
- a before/after measurement on a synthetic thread of `01a125fe` size (bench script in `apps/tagma/server/scripts`, not an itest): fork time and SQL request count; the result goes into the task finish;
- `bun run typecheck` of the affected packages, tests of the affected layers.

Result (commit 098f9378f2). Measured with `bench-thread-fork.ts --turns=870 --told=85` — one run each on the operator's machine under other agents' load; source 8 785 events / 8 700 records (29 MB) / 1 740 messages:
- before: 41.7 s, 45 313 SQL requests (`ThreadStorage.append` ×8 701 — 18.1 s, `suffix.replay` ×3 — 14 s, writer held 33.7 s);
- after: 4.2–13.1 s over five runs, 81 requests at any size; the main share is the child FTS insert (3.1 s of 4.2 s in the calm run), the child rollout (31.8 MB) is written in 1 MB chunks.

Not proven / open:
- the FTS insert and the message projection into the worker run inside the birth write-unit: the writer is held for seconds, and a worker refusal refuses the fork;
- the child rollout export stays in the answer (`EngineBirths.ready`): rows are no longer written one by one, but the whole journal is read and serialized on the event loop;
- the 4–13 s spread is loaded-machine noise with no stable figure; there is no measurement on the real `01a125fe` thread.

The report carries a map of all readers and writers of the thread journal and its projections (events, `thread_entry`, history, fold, conversation index, rollout, eviction/return, tool trimming, deletion): the instant-fork spec through a source-prefix link needs it.
