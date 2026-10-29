---
id: 01a0e532-c828-7195-a4be-9fc6f3aa2e7e
title: "Cross-module step: perf E5"
ord: 38
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e533-8064-7d5a-81fb-ef815c9f98b7",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0e470-ffc4-7261-8631-2ffbf7e0b9dd
  - kind: waits-on
    to: 01a0e532-ca72-7893-99fe-0e2dcf64b2b5
  - kind: waits-on
    to: 01a0e532-cc63-7cd6-8936-6e61092bdeb0
  - kind: waits-on
    to: 01a0e532-ccaf-7331-8d38-65646e5ffef6
  - kind: waits-on
    to: 01a0e532-cd15-715f-9e9a-7f337ef8ff1f
---
The tracked task `perf E5` of §7.2.2 and §7.2.4 ([[f7e0b9dd]]).

## As built — divergences from §3.13.7.5 of [[9c085c6c]] and §3a/§4 of [[e4f76910]]

Built through phase D on branch `restructure`. Phase E, the journal lane, is not built.

1. **Decisions carry derived events.** A decision may return extra events. The kernel seals them and folds them onto the prepared state inside the unit, at a cost proportional to what changed, instead of re-preparing through `redeclare` on every run end, which would double the units on the hot path (rule 2393aff1).
2. **A separate port.** The transition port is its own service, `ThreadTransitions`, not new members on `ThreadStore`. Acts decided from their own rows use `decidedBy` evidence. The system-prompt freeze is one of them, so `runStart` evidence is gone.
3. **Snapshots and counters.**
   - Tagma's snapshot is a seqlock (version, then the reads, then the version again, up to 8 attempts), because a read unit opens no read transaction.
   - The fold and inherit counters live in narrow tables (`native_thread_rev`) with per-row triggers.
   - Tagma's trigger omits `owner_id`, `agent_id`, `created_by` and `born_of`, which live on `thread_record`/the mandate.
4. **Keyed run starts.** A keyed start (start, continue, idle compaction, compaction ahead) writes `thread_run.start_key`/`start_digest` in the unit that accepts the run's first turn or compaction activity, not in the unit that created the run.
   - A failure between those two units leaves a run that no key names.
   - Two runs finishing one after the other under the same key collide on the unique index, and the collision fails loudly.
   - A start's digest covers only its provision item id; the text travels on the provision row.
5. **Births.**
   - Spawn receipts are `envelope:spawn:<parent>:<key>`. Legacy `envelope:spawn:<key>` receipts are not found, which is the pre-migration horizon.
   - Fork births are keyed by a `fork` `thread_call`, as is a spawn without a provision.
   - A fresh spawn rechecks the parent's inherited fields inside its unit and retries until the deadline. Unlike fork, it does not refuse a parent with a pending interaction or a foreign run.
6. **Replayed idle compaction.** A replay answers the outcome recorded in the run's entries, with history `before = after =` the current length, because the counts are not recorded.
7. **The `act-spent` code.** The kernel answers `ThreadActSpentError` (`code: 'act-spent'`). The facade takes `call?: CallerKey` on `append`, `attachContext` and `answer`. Wiring Tagma's doors to pass the key belongs to threads M2 (wave-thread-record, told). External births are keyed on wave-package-boundary's `SessionBirthRows` road.
8. **Open.**
   - No `stalled { uncertain }` outcome.
   - No lane and no fairness (phase E).
   - Tagma's append is not idempotent by event id.
   - The global event-id index costs O(all events) per append.
9. **Graph.** The worktree graph carries the claim rewrites (257c9f8e, 4b5edb61, eb6d9b19, a6c22332, ac058ca1, 28c9827e) and the new area 88fd77fd with claims 750db307 and 09ca0ed8. Main receives them at merge (line on [[4a9013bf]]).