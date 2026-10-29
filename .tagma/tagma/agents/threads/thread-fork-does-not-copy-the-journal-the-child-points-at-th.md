---
id: 01a14703-e84d-735b-a73a-ab4863734311
title: "Thread fork does not copy the journal: the child points at the source prefix, and writers that change the prefix in place preserve the child's view"
ord: 57
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a12699-1673-714b-a6a5-79efc3af42eb
  - kind: relates
    to: 01a146a3-b69e-7701-8802-1c7c467f23ab
sources:
  - kind: dir
    ref: apps/tagma/server/src/threads/journal
  - kind: file
    ref: packages/agent/src/thread/run/ThreadBranch.ts
---
**Outcome.** Forking a thread of any size — `branch_thread` from the menu and from a message, `fork_thread`, spawn with `fork` — answers in time that does not grow with the source journal, and copies none of it. New bytes in the database and on disk are only what the child writes itself. To a person and to an agent the child is indistinguishable from a full copy: the same feed, rewind points, attachments and tool outputs, searchable lines, `read_thread` facts. After the fork the source lives as it lived: its rewind, compaction, output stripping, offload and deletion do not change what the child sees.

**Why not a copy.** After [[1020c14d]] and [[6f5b4b73]] a copy costs a constant in requests, but its bytes grow with the source: a thread with 34 MB of transcript gave its child ~57 MB of rows and 40 MB of rollout, all under the database writer. Agents fork often: spawn with `fork: all` carries the parent's whole history. The model needs only the collapsed history from the prefix — for the same thread 81 rows, 1.1 MB; the rest is the journal for the feed, evidence and search, which the child can read from the source.

**Design.**
- **Child journal = source-prefix link + own tail.** The child stores `base`: the source thread and the `through` position (head at fork time or the "before the run" slice). The child's positions `1..through` are the source's positions; its own records start at `through + 1`. Chaining is allowed: a fork of a fork links to its own base.
- **One owner resolves the base.** All journal reads and its projections go through the existing owners — `SqliteThreadJournal` (`threads/journal/log.ts`), transcript folding (`native-harness/transcript/*`), the conversation index, reading an offloaded thread from file; the consumer knows nothing of the base. Reading the prefix is "as of `through`": a record revision the source made later is invisible to the child (`revisionsAsOf` already does a head-bounded window).
- **What the child writes itself at birth:** the thread row, the folded model history, its own diffs from the prefix — sealed open calls, cut-off runs, the dropped `system-prompt` on agent change — and cursors. This is a constant plus the model-history size.
- **Copy-on-write at every writer that changes the prefix in place.** A writer that edits, deletes, or moves source rows at positions a live child points at first saves the child what it saw. Writers per the 1020c14d report map: `thread_entry` folding on a new revision of an old record, rewind/withdraw via `place`, output trimming and bounding (`maintenance/stripping.ts`, `bounding.ts`), footprints, compaction markers, rollout forms, offload and return (`threads/journal/rest.ts`, `replay.ts`). Output trimming that would apply to the child itself may run on the shared prefix without copying — the implementer proves it does not change what the child sees, or copies.
- **Shared-prefix lifetime.** Deleting the source does not destroy a live child's base: the prefix materializes into the child or stays a hidden segment while referenced. Offloading the source moves the prefix into its rollout, and the child reads it from there; returning the child does not require returning the whole source.
- **Child rollout** carries the base link and only its own tail; export, recovery, and moving a thread between machines (if it appears) materialize the prefix themselves.
- **Search.** A line from the prefix is found in the child as in a copy: the conversation index answers the source's matches with position `≤ through` for the child too, instead of indexing them twice.

**What the implementer decides, by measurement:** whether to keep the child its own fold overlay for records the source revised after `through`, or to read the prefix "as of `through`" from events. Criterion — the child's feed window opens no slower than the same-size source's.

**Touches:** fork core `packages/agent/src/thread/run/ThreadBranch.ts` and the storage port `ThreadAggregateStorage` (core without SQL, second implementation — in-memory conformance); `apps/tagma/server/src/native-harness/rows`, `transcript`, `maintenance`, `compaction`; `threads/journal/*` (journal, rollout, offload, return, conversation index); thread deletion. Related to [[c3af42eb|offloading journals to rollout]]: both change the same writers, order is agreed before starting.

**Acceptance — proved by the implementer:**
- forking a synthetic 1 GB-journal thread answers in the same time as forking a 1 MB-journal thread (sample on one machine, bench in `apps/tagma/server/scripts`), and adds bytes on the order of the folded model history to the database;
- fork, rewind, spawn and `branch_thread` conformance pass with the same expectations as a copy;
- per-listed-writer contract test: after its act on the source prefix the child's feed, rewind points and facts are unchanged;
- deleting, offloading and returning the source with a live child leaves the child readable and unchanged; deleting the last child frees the hidden prefix;
- a prefix line is found by `search_threads` in the child.

**The operator checks:** forking a large thread from the menu opens the branch instantly.
