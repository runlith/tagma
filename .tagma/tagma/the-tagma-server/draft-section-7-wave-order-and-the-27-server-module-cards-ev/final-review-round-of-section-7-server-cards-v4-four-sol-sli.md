---
id: 01a0e447-1f48-7468-9b13-d86923a1feed
title: "Final review round of section 7 server cards v4 (four Sol slices in parallel): 11 blockers, 1 high — all transitions and seams"
ord: 2
---
Four GPT-6 Sol reviewers read the four slices of v4 at the same time (A: frame + W0–W1, B: W2–W3, C: W4–W5, D: W6–W7). This was the last review round: the tagma agent decides the fixes below and the author applies them in one pass; no further round. Each finding is kept as its reviewer wrote it.

## Slice A

Verdict on slice A: **fix-list**. Three transition blockers; tests and typecheck were not run.

1. **W1 breaks model selection after `default_accounts` removal** — [[4c09d51e|cards]] §7.2.4, lines 132, 566, 640: `providers` moves the data and deletes the column already in W1, while rewriting the rest of `thread_owner_settings` is deferred to W6. The current `thread/ThreadOwnerSettingsStore.ts:39–65` reads this column at `modelSelection`, and `:145–207` reads and writes it at `saveModelSelection`; `harness/AccountDefaults.ts:145–149,205–215,225–231` calls both paths. So even after moving `defaultAccount` to the new table, reading and writing model preferences fails on the missing column. **Fix:** move these two current paths to `DefaultAccounts` in the same W1 migration, before deleting the column; W6 only moves already-working code.

2. **`settings M1` loses the key catalog before its owners appear** — [[4c09d51e|cards]] §7.5.3, lines 466, 476, 492–511, 541; §7.2.7, lines 154–171. The card requires building `keysById` from manifest contributions, while ten owners move keys out only in their own later M1s; the bindings table has no interim source for them. Now `graph/core/Settings.ts:86–87,263–268,443–451` builds and serves reads/writes over the shared `SETTING_KEYS` declared in `protocol/settings.ts:1794–1884`. An incomplete catalog will break `read_settings` and refuse existing keys as `unknown-setting` after a runnable M1. **Fix:** wire the old declarations temporarily into the `settings M1` build, replacing each group with its owner's contribution at its M1, then delete the interim source at `settings M2`.

3. **The task graph admits `thread-record M2` before the D4 migration** — [[4c09d51e|cards]] §7.2.2, lines 46, 57, 61–67; §7.5.5, lines 654–676, 684–699. `control/milestones.mjs:37–43` puts D4 only before `thread-record M3`; `M2` may merge the final map, the `thread_record` table, and its view while data still lives in `thread` (`db/thread.ts:45–91,197–241`, `harness/ThreadTitleStore.ts:26–61`). This contradicts the mandatory working-after-every-merge. **Fix:** add `thread-record M2 waits-on D4` in the generator and §7.2.2, or explicitly provide a dual-schema M2 implementation before D4 with proven preservation of all reads and writes.

## Slice B

Verdict B: **fix-list** — three blockers.

- **`workspace`, §7.5.6, lines 759, 766, 815, 867:** `GET /api/checkouts/:rootId/picture` is wrongly translated into `read_picture` and must go away with the typed routes. It is now a binary HTTP resource: `http/handlers/checkouts.ts:56–69` returns raw bytes, MIME, cache policy, and `nosniff`; `app/src/lib/features/checkout/PictureDiff.svelte:41–58,103–108` loads it as a Blob for `<img>`. An operational JSON answer breaks the image and its HTTP contract. **Fix:** keep this GET as an HTTP resource, move reading and type checking into `workspace`, keep headers and URL; exclude the route from the K2 translation into an operation.
- **`workspace`, §7.5.6, lines 769, 833:** `read_path_exists` is declared as "a path at the root", but the current `GET /api/files/exists` checks the path specifically relative to the graph-served checkout (`http/handlers/files.ts:149–167`): `CurrentGraph.checkout`, the lexical boundary, and `realpath` of both ends prevent escaping through a symlink. The map carries over only the `protocol/files.ts:3–5` schema and does not define passing the served checkout into `workspace`; the implementer must invent root semantics or lose the protection. **Fix:** hand the operation to `graph`, which owns the served-checkout choice, and use the `workspace` primitive with the same real-path checking.
- **`change-record`, §7.5.10, lines 1232, 1255, 1279, 1291–1294:** the map removes graph from dependencies and sends task labels only to `landing`, although `read_changes` returns `tasks` in every row, including when reading someone else's path (`protocol/evidence.ts:427–436`, `operations/session.ts:659–665,723–737`). Today `WorkspaceChangeLog.ts:499–519,616–645,1225–1275` fills them via `namedHolders`; `graph/projects/holders.ts:47–80,82–106` reads tasks from graph storage. Without a replacement import the result impoverishes, and keeping the import breaks the declared module boundary. **Fix:** define in the map a task argument/port that graph fills at build for every `read_changes` read; tasks for `landing` do not replace this contract.

Verified by reading the cited passages and sources; tests and typechecking were not run per instructions.

## Slice C

Verdict on slice C: **fix-list**. Three transitional bindings do not keep the promised guarantees.

- **Blocker — `power`, §7.5.11, lines 1320–1326 and 1343; §7.2.7, lines 154–171.** `PaceDoor` is declared at `power M1`, while its implementer arrives only at `executions M1`; the exhaustive table has no transitional binding. Now `terminals/terminalsLayer.ts:380` passes `executions.pace` into `holdAgentPace`, which publishes exactly the host's answer (`power/AgentPace.ts:49–60`); the `unavailable` state with an unbound port will rob a working host of pace control. **Fix:** name the old host producer, the install point at `power M1`, its answer semantics, and the replacement at `executions M1`.
- **Blocker — `worktrees`/`landing`, §7.2.7, line 164; §7.5.17, lines 1663 and 1710; §7.5.18, lines 1769 and 1788.** The interim `PreservationCommit` declared for `worktrees M1` points at the archive in `working/WorktreeFinishing.ts`, but `archive` does `stageAt`/`commitAt` directly with no key, witness, or receipt (`working/WorktreeFinishing.ts:552–592`), and that part moves to `worktrees` ahead of the mandatory `landing M1`. After a failure between commit and delete, the old producer cannot answer an archive request by key as the accepted contract [[f658e190]] §1.4.3 requires. **Fix:** raise the real keyed `landing` publication with intent/witness/receipt up to `worktrees M1` and bind the archive to it; plainly calling the old `archive` is not a transitional port implementation.
- **Blocker — `landing`, §7.2.7, line 171; §7.5.18, lines 1749–1750 and 1804.** The interim `MergeNotice` old producer writes `WORKTREE_ENTRY` into transcripts after the git merge (`working/WorktreeFinishing.ts:421–460`, `harness/WorktreeNotes.ts:73–118`), swallows errors, and does not write to inbox in the unit that preserves the merge receipt; so `landing M1` does not deliver the promised C2b before `threads M1` ([[f658e190]] §1.4.3). **Fix:** place a working transactional inbox binding with receipt in `landing M1`, or move the port declaration and the transition onto it into one joint step with `threads`, keeping the old path working until then.

## Slice D

Verdict: **fix-list**.

**Blockers**

1. **`socket`, §7.5.25, lines 2318–2338:** RPC generation from manifests assigns no owner to three live feeds `accounts.subscribe`, `awake.subscribe`, `pace.subscribe`. They are implemented directly in `socket/live.ts:80–82`, declared in `socket/rpc.ts:112–126`, and consumed by the app (`UsageAccounts.svelte.ts:28`, `Awake.svelte.ts:31`, `Pace.svelte.ts:31`). The map lists moving nine `*Channel.ts` but these three feeds have no channels. **Fix:** explicitly record `providers`, `power`, `executions` as owners of the corresponding feed declarations and their manifest registrations before `socket/rpc.ts` generation; keep existing schemas and names.

2. **`threads`/`native-harness`/`socket`, §7.5.20 lines 1900–1904, §7.5.21 line 2075, §7.5.25 lines 2318 and 2328:** nine act-verbs `thread.send/queue/steer/answer/compact/continue/stop/model/authority` must become operations per accepted §4.4.3 (`spec-04-contract.md:272`), but the maps name new IDs, owners, and contracts for most of them. Now `socket/threadChannel.ts:100–170` calls `ThreadActs`/`AccountDefaults` directly; the existing `send_message` addresses a different agent, while `thread.send` opens a turn of the named thread. RPC renames alone cannot produce shared admission/verdict/callKey. **Fix:** give the full table verb → operation ID → owner → input/answer/refusals, including `thread.unqueue` (present in `socket/rpc.ts:148–152` and the map), and bind the owners' M2 to publishing these operations.

**High**

- **`composition`, §7.5.27 lines 2360–2363 and §7.2.7 line 156:** `composition/start.ts` must install transitional bindings already at `projects M1` and `threads M1`, but `composition M1` opens only after every other module's M1. Launch now builds through `http/runtime.ts:472` → `harness/Stack.ts`, and the maps say neither when the early `start.ts` appears nor how the old runtime calls it before W7. **Fix:** assign an early prep milestone for `composition/start.ts` and its call from the old build, or name the transitional install point inside the old runtime for each early M1.
