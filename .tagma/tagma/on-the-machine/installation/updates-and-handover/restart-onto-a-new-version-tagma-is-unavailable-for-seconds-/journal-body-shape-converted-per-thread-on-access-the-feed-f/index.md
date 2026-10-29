---
id: 01a12699-1673-714b-a6a5-79ee8d4a4eb8
title: Journal body shape converted per thread on access; the feed frame never waits for it
ord: 8
tags: ["spec"]
fields:
  {
    "status": "open"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/journal/rolloutForming.ts
---
When a stored thread record's shape changes, no update walks all threads' journals. A thread is cast to the current shape when accessed, and only it pays: an archived thread nobody opened for three weeks costs nothing on update, and a feed frame in the thread a human stands in never waits for the whole thread to cast.

## What stands now

- A record's shape is cast by a migration data step: it walks `thread_entry`, `thread_event`, `thread_run.stream_tail` and `native_thread.context_reading` of every thread, picking rows by `instr` (`threads/journal/entryFormsStep.ts`). Five such steps on Oct 9 took 243.6 s.
- The shape itself is one cumulative normalizer `currentEntryForm` / `currentPayloadForm` with record-owner contributions (`threads/journal/entryForms.ts:74-166`): it knows all old shapes at once. Contributions gather in module order (`composition/manifest.ts`, `ENTRY_FORMS`).
- The journal has two copies: SQL rows and the rollout file catching up with them. The shape mark lives only on the file — `thread_rollout_form`; the file is shaped whole on read and on return to SQL (`threads/journal/rolloutForming.ts:68-91`), and a feed frame waits for it (`threads/list/feeds.ts:113-126`).
- The mark is reset whole by migration, after which `formInBackground` (`composition/boot.ts:31`) walks all threads' rollout files after start.
- Some code reads bodies with raw SQL over many threads at once: the `thread_event_entry_idx` index and queries on it (`threads/journal/log.ts:313-351`), `rows/targetSnapshots.ts:79-80`, `foldedFacts.ts`, `externalLeftovers.ts`, `transcript/history.ts:55`. And `native-harness/maintenance/bounding.ts:139-160` maintenance walks `thread_entry` of every thread and rewrites bodies.

## What is built

**Shape steps.** A step is a named transform of one record; it never changes a record in the current shape. A module declares its steps in the manifest, composition gathers them into one order by name; the name starts with a timestamp, as migrations do, so a new step is always last. A malformed name, repeat or order violation refuses at composition build; a step with a name earlier than an already landed one refuses on landing — the migration-law inspection carries this check ([[9631d38c]]). A step gets only the record, never the thread identity. A new shape is a new step; no migrations or mark resets for it.

**One mark.** A thread has one shape mark — the name of the last step its whole journal walked; its place is the current `thread_rollout_form`.

**Steps applied by the record-decode owner** (`ThreadEntryReader`, `packages/agent/src/transcript/kinds.ts`) — to every served record, never checking the thread mark: a record in the current shape is unchanged by a step, so the result is the same. Feed window, single record, run tail, model history come out in the current shape, and an old-place frame costs as a feed window, not as a thread. Reading code still knows only the current shape; old shapes are known only to steps.

That costs checking every step on every decoded record. Steps persist between releases, so their accumulating cost is a review condition: the mark must reach record decoding, so a cast thread never pays for already walked steps again. That is a separate read change, not part of the cut-condition edit.

**A SQL-resident thread is cast whole when work continues in it** — inside return (`rollouts.rehydrate`): continuing work, child birth, rollback. Opening the feed and reads never cast it: unloading from under a parallel reader would tear the read, and readers get the current shape from decoding anyway. An unloaded thread's file, when read, queues its background shaping in the thread lane, and the read never waits for it. Cast always runs through the file:

1. a SQL-resident thread is unloaded with the standing unload — with its one-transaction check that the file holds the journal head (`threads/journal/rest.ts`);
2. the file is shaped with the missing steps — streaming, as now (`threads/journal/rolloutEntryForms.ts`);
3. the thread returns to SQL with the standing return (`threads/journal/replay.ts`), and collapses are derived anew by it;
4. the mark becomes current.

Rebuilding rows in place, with no unload, is impossible: event append runs past the journal lane, and during rebuild it would take a position on a partial table (`threads/journal/log.ts:110-185`). While a run is going in a thread or the file lags, unload refuses, and cast waits for the next access; reads stay correct because decoding applies steps. No separate SQL-row cast: two copies with two marks would diverge.

**What the mark decides.** Reads never wait for it: feed frame, full feed, model history and export get current-shape records from decoding. Appending a record never waits either: a new record is already in the current shape. The mark decides whether to cast the thread whole. Maintenance, which rewrites picked bodies, decodes them with the same reader and never waits for the thread mark. It never advances the shared mark: part of a journal may stay in the old shape. Each step carries samples of old shapes for all its transforms; the shared contract set requires the sample to be transformed without mutating the input and to reach a fixed point when the step is repeated. So a record cast by maintenance never changes again on next access. A thread nobody accesses is never cast whole.

**Stored shapes outside the journal** — `thread_run.stream_tail`, `native_thread.context_reading` and `pending_interaction` — walk the same steps: on decode and in the same transaction that sets the mark.

## What is built and what stays open

The mechanism landed with task [[0911272b]]. The first step `20261010205500_place_guidance` moves single-project law to the project map on record decode; resident-thread maintenances never wait for the shared mark. The forming walk at start and every 24 h is deleted ([[189c0df4]]); a null mark — a row from before the `step` column — counts as lagging and is cast on its next access. A read of an unloaded thread no longer shapes its file in the read ([[a920fd6d]]): it refuses an unformable or older-than-base file, settles a publication a crash left behind, opens a compressed file and queues the shaping. Still open:

- **Unloaded-thread worker** (`rested.worker.ts`), which builds `.entries` and history, sees only record steps before background file shaping; payload and message steps it sees after shaping.
- **After whole cast** maintenance cursors reset with the return, and maintenance walks the thread anew once.
- **Unproven by tests:** the path through `ThreadRollouts.rehydrate` whole, parallel write during cast, frame time against thread length, and a restart rig with a new shape step.

**Multi-thread queries read only stable fields.** The journal owner declares the body paths SQL searches and picks by over many threads at once (today the `thread_event_entry_idx` index paths and fields from the list above). A query takes the path from that declaration by type, not by string. Shaping reconciles those paths' values before and after a step and refuses a step that changed them: such a change is a history-table schema change and runs per [[9631d38c]]. No new columns needed.

**Walking all threads after start is deleted** — both `formInBackground` over all rollouts and any background backfill.

## What was rejected

- **Casting shape on serve only, never writing.** Old rows would stay old forever, every read would pay again, and maintenance and body queries could never rely on shape — against [[acb620dd]]. The current cumulative normalizer is built exactly so and is deleted: [[842e3529]].
- **Casting the whole thread before the first frame.** Then the thread a human stands in would pay its full size in the window; one measured return — 52.5 MB in 1.86 s.
- **Backfilling all threads in the background after restart.** The same whole-history work, only hidden, and it fights a human for the single store writer.
- **Columns for body fields.** A stored column would need a journal-walk fill, and a virtual one is the same path freeze in other syntax.

## What changes in rules

Journal shape steps persist in code between releases; cut accounts for them in the release record. Cut conditions and why steps persist are described in [[f8616748|stored-shape machinery]].

## What the implementer proves

- A feed frame of a thread with a lagging mark arrives in the current shape, and its time never grows with thread length.
- After access a thread reads in the current shape from SQL and from file, and its mark is the last step; a neighboring thread nobody accessed kept its old mark and old bytes.
- A record added to a thread before its cast end never changed after cast.
- Adding a shape step needs no migration; a step that changed a stable field refuses.
- Run recovery in a thread with a lagging mark reads `stream_tail` and history in the current shape.
- A restart with a new shape step, when the client stands in a big thread, never lengthens the window — on the [[212d752c]] rig.
