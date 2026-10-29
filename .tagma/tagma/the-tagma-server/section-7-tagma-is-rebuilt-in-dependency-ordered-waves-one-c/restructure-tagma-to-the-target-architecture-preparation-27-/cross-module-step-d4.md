---
id: 01a0e532-c80d-75fb-8775-ff60ae74039e
title: "Cross-module step: D4"
ord: 35
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e5c4-94b9-7fed-bbb0-6060db0ffafa",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0e470-ffc4-7261-8631-2ffbf7e0b9dd
  - kind: waits-on
    to: 01a0e532-c949-7ee7-90f4-b9199b5cb879
  - kind: waits-on
    to: 01a0e532-cf53-7b2b-9a17-c5c7218bce5a
  - kind: waits-on
    to: 01a0e532-cf5c-79fb-9e24-8c515b6f255b
  - kind: waits-on
    to: 01a0e532-cf85-726e-87cf-c2e18895a248
  - kind: waits-on
    to: 01a0e532-cf8d-764d-ab2a-33306876a2fb
  - kind: waits-on
    to: 01a0e532-cf95-7086-a9ba-3ac545dfd7c6
  - kind: waits-on
    to: 01a0e532-cf9c-7085-964b-776dfbec9685
  - kind: waits-on
    to: 01a0e821-e94a-789b-aa92-ce05b5977128
---
The tracked task `D4` of §7.2.2 and §7.2.4 ([[f7e0b9dd]]).

D4 is built in `restructure` in four steps. It finishes only when step 4 has landed.
1. Additive: the owners' relations and writers over today's tables.
2. Every reader and writer moves onto those relations and writers, one commit per group.
3. The destructive migration. It runs after the double review of its SQL and after the snapshot from [[b5977128]].
4. The leftover declarations move, with their lower readers:
   - `thread_inbox`, `thread_owner_rule` and `thread_seen` go to threads;
   - `thread_run`, the folds and their helpers go to native-harness.

   Each group lands as one commit, together with its readers' ports or testing entries.


**Step 3, as landed (67213df7b8).**
- **Shape.** Every thread's record lives in the table `thread` (thread-record, Drizzle `threadRecord`), the one foreign-key target for native and external threads alike. Native-only columns live in `native_thread` (native-harness, Drizzle `thread`). `thread_mandate` (threads) and `external_session` (external-harnesses) hang off `thread`. The rest stamp is `thread_rollout_cursor.rested_at`. The design's `thread_record` table name was folded into `thread` so that no foreign-key child is rebuilt.
- **Upgrade cost follows the thread count, never the history.** The migration rebuilds `thread`, fills the three new tables and adds the cursor column by ALTER ADD. It writes no history table. External threads' fold restore and native-child deletion run afterwards in `native-harness/externalLeftovers.ts#clearExternalLeftovers` (moved there in step 4): one transaction per thread, idempotent, driven once per boot after the port by `harness/Stack.ts`; it restores folded event bodies before deleting folds and proves per thread that no native child remains.
- **Stated limit.** The database no longer enforces that native-only children (`thread_log`, `thread_entry`, `thread_history_item`, `thread_compaction_checkpoint`, `thread_pruned_tool_call`, `thread_cache_observation`, `thread_run`, `target_snapshot`) point at a native row: they keep their foreign key to the record, because re-pointing them would rewrite the largest tables. Each writer checks the native row in code, pinned by itests (the unit layer refuses SQLite): `ThreadStore.appendEntries` refuses an external record, `ThreadRunStore.createRun` refuses one, a record with harness `tagma` and no native row fails as missing storage, carry and rehydrate write journal rows only for an external record (`thread/externalRecord.itest.ts`, `external-harnesses/rollout.itest.ts`). Until the leftovers pass has run, an external thread's legacy native children are harmless rows whose foreign keys hold. `thread_cache_observation` rows of external threads are left in place (no `thread_id` index).
- **Measured on a full 18.5 GB clone of this machine's store (one sample):** migration statements 6.9 s warm, 12–31 s cold; WAL 221 MB. Killed mid-transaction at 137 MB WAL the old shape stood (`integrity_check` ok) and a rerun succeeded in 12 s. The chain frame's foreign-key check over every referrer of the rebuilt `thread` first cost ~155 s (`thread_event` 87 s, `thread_entry` 34 s, `thread_history_item` 31 s); after wave-platform's parent-key comparison (916b606255) the whole migration, checks included, landed in 14.5 s cold through the real chain. Room for the D0 snapshot: ≈ 893 MB here, with a safety factor until a full run replaces it.
- **Reviews.** Opus and Astra on step 3 (blocking: external replay/wake and journal appends writing native folds; the unmeasured full run), then Muse re-checks of the fixes, of the reshape and of performance; every finding that held was fixed. Deferred, tracked: an external thread's transcript page replays that thread's whole journal (this store holds no external events); `ThreadRecords.statusPublished` still rides the composition's transitional feed; `keyed` does not use the `(cli, session_key)` index; a rested external thread's history read folds its rollout to answer `[]`; `applyPatch` dies rather than returning `ThreadStorageFailed` on a native field sent to an external record.
- **Not run:** every itest written for step 3 (`thread-record/threadSplit.itest.ts`, `native-harness/externalLeftovers.itest.ts`, `thread/externalRecord.itest.ts`, `external-harnesses/rollout.itest.ts`, the adjusted rollout and harness itests), under the restructure's typecheck-and-unit-tests rule; they run at the merge.

**Step 4, as landed.**
- d17e341b58: `thread_inbox`, `thread_seen` and `thread_owner_rule` declare in threads (`threads/store/inbox.ts`, `threads/store/ownerRules.ts`).
- 05d6bcc21c: the record's declaration moves to `thread-record/store/table.ts`.
- ea2d254517: `db/thread.ts` is gone. `native_thread`, `thread_run`, `thread_log`, `thread_entry`, `thread_history_item`, the checkpoints, the pruned calls, `thread_owner_settings` and `typeOf`/`runIdOf` declare in `native-harness/store/thread.ts`. The rollout sync and eviction (threads) touch no native table: folded-body reads, held checkpoints and pruned calls, fold rows, clearing and the `thread_log` settle go through `RolloutParts.native.folds` (`native-harness/rolloutFolds.ts`). `clearExternalLeftovers` moves to native-harness. `WorkspaceChangeLog` reads the running run from the record's `running_run_id`. `http/caller.ts` reads runs through `runFacts` in `native-harness/row.ts`, a new debt entry owned by http's door cut `dd5ad950` in the crossing class nine other http files already carry. The cli, http and rollout itests seed native tables by raw SQL.
- Every step-4 commit passed the modules and names inspections with 0 new violations in its paths, and a typecheck with no error in its paths. Their itests are not run; they run at the merge.
