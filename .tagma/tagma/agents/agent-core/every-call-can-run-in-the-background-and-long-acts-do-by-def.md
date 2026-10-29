---
id: 01a0ef52-d739-70b6-a9e5-20ac3bfd8b95
title: "Every call can run in the background and long acts do by default: a detached call answers a receipt at dispatch and its outcome is owed durably to the caller's thread — delivered as a notice, surviving the run's end and a restart, the same at every door"
ord: 119
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a0c3c3-5cae-7cce-af4b-00c64ef45bc7
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/http/operations.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/calls/delivery.ts
  - kind: file
    ref: apps/tagma/server/src/platform/contract/wire/projection.ts
  - kind: file
    ref: apps/tagma/server/src/threads/ending.ts
  - kind: file
    ref: packages/agent/src/agent/AgentCalls.ts
  - kind: file
    ref: packages/agent/src/agent/AgentToolDoor.ts
  - kind: file
    ref: packages/agent/src/agent/tool.ts
---
## 1. Outcome

Every call can run in the background, long ones do by default, and no caller loses one because its turn ended. Every tool and operation takes one field, `background`: asked `true` — or left out on an act declared **long** — the call answers a **receipt**, `{status: 'running', runId, toolCallId}`, the moment it is dispatched, runs to its end owned by the caller's **thread**, and its outcome reaches that thread as a notice on the road command endings take: into a going run at its next step, opening a warm idle thread's turn, kept for the next turn otherwise. Any call is readable (`read_calls`), awaitable within a bound (`wait_call`) and stoppable (`control_call`) by that address. The end of the caller's run does not end it; a server restart settles it with a truthful outcome that is delivered. Every door takes the same field and answers the same receipt.

## 2. Problem, with its evidence

Observed on 2026-09-29 by the parent tagma thread and read against the code:

- `compact_agent` on an idle child waits for the compaction (its own description: "the call waits and returns the outcome"). Seven in one step held the turn for minutes; the model cannot hand its own call off, because its step waits on the call.
- No call can be started detached. Only `bash` has `background`; the hand-off ([[1093f1ae]], [[4d1ae96e]]) is reachable only after dispatch and only by someone else — the operator's button or another thread's `control_call`.
- Background work belongs to its run. `EndingWalk.stop` ends the stopped run's invocations through `AgentCalls.end(…, run)`, background ones included ([[4c236b73]]); the seven calls came back `cancelled: The thread owning this invocation is ending.`
- Delivery lives in memory. `CallDelivery.completed` signals from the call's own fiber; a restart loses it, and the door's receipt says so ([[4f7186ee]], [[d7318d13]]). `read_calls` states "A restart holds nothing".
- A completion that finds the thread idle is only persisted (`ifIdle: 'persist'`): the thread learns of it when somebody next writes, unlike a command ending ([[faa651a3]]).
- Operation declarations carry a `deadline` kind that nothing reads.

## 3. What holds now (checked against the code before this change)

- The kernel's `AgentCalls`/`AgentCall` hold every native tool call in flight, keyed `(runId, toolCallId)`, process-local, with `mode: foreground | background`, a `detachable` offer from dispatch, a hand-off that resolves the model's wait with a receipt while the body runs on in the calls' own scope, and `CallHooks.completed` for a handed-off call. A run's abort stops only foreground calls; `AgentCalls.end(threads, cause, run)` stops every call of that run.
- `CallDelivery` (native-harness) sends `tool-result` signals, `ifIdle: persist`, and drops an answer whose completion is the command owner's ([[d7318d13]]).
- `read_calls` / `control_call` (native-harness) read and control the live record; the socket `calls.subscribe` feed projects it; the app draws `Background`.
- Command endings are the durable model: an obligation row opened with the command, a driver that delivers on ending and walks outstanding rows at boot, the thread's acceptance ending the obligation in the same unit, `wakeUnlessCold` ([[3ebd709e]], [[45342928]], [[faa651a3]]).
- Door calls (`/api/op/<id>`, MCP, `tagma op`) perform inside the HTTP request; the native tool door is `invocation/nativeDoor.ts`; collaboration and workspace tools (`compact_agent`, `send_task`, `bash`, …) are kernel tools that never pass `invocation`. Every tool, the MCP servers' included, is built by the kernel's `Tool.make`.
- There is no timer that moves a call to the background: every hand-off is somebody's act.

## 4. Target model

**One invocation, two holders.** The kernel's `AgentCall` stays the live holder of every call — identity, execution, cancellation, hand-off ([[4ef45bc7]]). A call in the background additionally has one durable row, `owed_call`, that exists exactly while its outcome is owed to its thread. Every road into the background is the existing hand-off: the operator's button, `control_call background`, and — new — the door itself at dispatch.

1. **Duration is declared by the act.** A kernel `Tool` and a Tagma operation declaration each may say `duration: 'long'`, by the rule in §14; nothing lists long acts centrally. The operation's declaration reaches its native tool through `nativeDoor`. The dead `deadline` kind is left to its owner card ([[d925fa0c]]); duration is a separate fact — the whole-call deadline bounds a call, duration decides whether its caller waits by default.
2. **One field, on every tool and operation.** `background?: boolean` — the word and meaning `bash` already teaches: answer with the call's identity instead of waiting. It belongs to the door, not to the act: `Tool.make` adds it, one short line, to every object input schema the provider is offered (its own codec never sees it), and the operation doors add it the same way to every operation's schema; each door strips it before the act's codec decodes. A tool whose input already declares its own `background` (`bash`, whose field detaches the command itself) keeps its own and is not detached by the door.
3. **The default.** Absent, `background` means `true` for an act declared long and `false` otherwise — for a caller that owns a thread and a host that owes outcomes durably. A caller with no thread (the operator's own requests) waits unless it asks, because a receipt with nowhere to deliver the outcome is no service; a host that records no obligation (the kernel alone, its conformance suite) runs every call in the foreground, because a receipt it could not honour would lose the outcome.
4. **Detach at dispatch.** A call admitted detached is handed to the background the moment it is dispatched — after its permission, before any queue wait — through the same hand-off, answering its tool's receipt or the door's own.
5. **The hand-off opens the obligation first.** A hand-off opens the `owed_call` row before it resolves the model's wait, so no receipt exists whose outcome is not owed durably. If the row cannot be written the hand-off is refused with the store's reason (`control_call` answers `unavailable`; a call detached at dispatch runs in the foreground). A call whose body ends while its row is being opened waits for the hand-off to settle, so it lands on exactly one road.
6. **Owned by the thread.** A background call ends only by its own stop (`control_call stop`, the operator's button), its limit, an idle stop of its thread (the operator's stop of everything the thread still has going), the thread's deletion, or the server's end. A run's stop — and a run's end — ends that run's **foreground** calls only.
7. **Durable delivery.** At its end a background call writes its outcome — `completed | failed | stopped` and the model-facing words, bounded by the tool-output envelope that already bounds them — onto its row, and the delivery driver sends it as a `tool-result` notice on the road command endings take, waking a warm idle thread; the thread's acceptance deletes the row in the same unit, so a resend never duplicates. An answer whose completion is a background command's ([[d7318d13]]) deletes the row without a notice: the command's own notice is the one delivery.
8. **Restart.** Each server process mints an epoch. At boot the driver walks every row: a row from another epoch with no outcome is settled `interrupted` — "the call's ending was never recorded: the server stopped, or could not write it, before the call ended; whether its effect happened is unknown" — and delivered; a row with an outcome not yet accepted is delivered. Nothing resumes a body: a body's fiber dies with its process, and re-running an effect nobody can prove idempotent would repeat it. Probing an operation's `settle` seam at boot is a later refinement (§8).
9. **Uniform reading and control.** `read_calls` answers the live record and, beside it, the owed rows no live call holds (another epoch's, until delivered). `wait_call {runId, toolCallId, waitMs}` waits at most `waitMs` (≤ the longest act) and answers the outcome's words when the call ended and its notice is still owed — discharging that notice in the same unit, as a command's read does ([[6b77d5fd]]) — `ended` with no words when the notice already landed, or `running` at the bound. `control_call` is unchanged.
10. **Doors.** The HTTP perform door, and through it MCP and `tagma op`, reads and strips `background` for every operation and, when detached, opens the call in the same live record (`HarnessCalls`) under the caller's thread — addressed by the run its act header names, else a run id the door mints (`call:<uuid>`), with a minted tool call id — forks the perform into the calls' scope instead of the request's, and answers the same receipt. Dropping the request no longer ends a detached act.

## 5. Owners and boundaries

- `packages/agent` (the one door a tool call runs through, [[0361efbb]]): `Tool.duration`, the `background` field offered and stripped, detach at dispatch, the hand-off's `detaching` hook, `end` sparing background calls, the `interrupted` phase, the door's receipt words.
- `threads` (durable thread delivery, beside command endings): the `owed_call` table next to `thread_call`, the `OwedCalls` service in its contract (owe, end, read what is owed, take), the delivery driver on the road command endings take and its boot walk. It already holds the live record's tag (`HarnessCalls`) and the thread endings that end calls; what it records is an obligation to a thread, not the call.
- `native-harness` calls (the area [[e0ee2866]]): fills the kernel's hooks from `OwedCalls` and words each ending; `read_calls` merges the owed rows; `wait_call`.
- `invocation`: the door-level detach for `/api/op` (hence MCP and CLI); `nativeDoor` projects `duration`.
- Each module: declares `duration: 'long'` on its own long operations; `packages/agent` and `packages/agent-tools` on their long tools.
- `platform`: `duration` on the declaration shape.

The mechanism is not placed in the server's `invocation` module: kernel tools — `compact_agent` among them — never pass `invocation`, while every native call passes the kernel door and native-harness's hooks, and every door reaches `threads`' contract; `invocation` keeps the doors.

## 6. Rejected alternatives

- **The field on long acts only.** A caller cannot know a call will be slow on a loaded machine, and a hand-off after dispatch still holds the turn until someone else makes it; one short line per schema is the price of the choice being the caller's.
- **The field in each act's own codec.** It would reach every body and every subject projection; a door field stripped before the codec reaches none of them, and a tool with a `background` of its own keeps its meaning.
- **A timer that moves a call to the background after N seconds.** Nothing in the code does it; a timer would tell the model "running" for an act it could have waited for, and the default by declaration answers at once for the acts that are long.
- **Resuming bodies after a restart.** An effect cannot be proven idempotent by the door, so replay could run it twice; the truthful `interrupted` is always available.
- **The ledger in `invocation` or `native-harness`.** Either would need `threads` below it to deliver through a road it would have to expose, or would need a port for every kernel hook; the obligation belongs where durable thread delivery already lives.
- **A generic `start_detached({tool, input})` tool.** It bypasses each tool's permission subjects, display and receipt.

## 7. Acceptance

1. A thread calls a long tool seven times in one step: every call answers its receipt within the step, before any body ends; the run ends (and, separately, is stopped); all seven bodies finish; the thread receives exactly seven `tool-result` notices, and an idle warm thread is woken.
2. A row opened by one epoch with no outcome is, at the next process's boot, settled `interrupted` and delivered once; a second boot delivers nothing more. A row with an outcome not yet accepted is delivered after a restart.
3. Door parity: one long operation called by the same thread through the native tool and through `/api/op` with `background` absent answers the same receipt shape at both, is listed by `read_calls` with mode `background` at both, and delivers one notice each; `background: false` answers the operation's own answer at both; a short operation asked `background: true` answers a receipt at both; an operator's `/api/op` call without the field waits.
4. `wait_call` answers the words once — a later notice is not sent — and `running` at its bound; `control_call stop` ends a background call with `stopped`.
5. A hand-off whose row cannot be written answers `unavailable` and the call answers in the foreground.
6. `compact_agent` answers at once; the collaboration conformance suite, which runs the kernel with no durable host, stays green.

## 8. Claims and tasks it touches

- [[4c236b73]] — rewritten: a turn's stop ends that run's foreground invocations; background ones end by their own stop, limit, idle stop or deletion.
- [[4f7186ee]], [[d7318d13]] — rewritten: the receipt and the delivery are durable.
- [[0e431435]] — qualified: the window is process-local; background calls are also held durably until delivered.
- [[1093f1ae]], [[4d1ae96e]] — hold; the hand-off gains the durable first step.
- [[a759db7d]] — qualified: the provider face is the codec's plus the door's `background`.
- [[4ef45bc7]] — this extends it; its open task [[b2793096]] is untouched.
- New claims from the code at close: the obligation row, the boot walk, the `background` field and its default, the thread's ownership, door parity.
- Follow-up task: probe an operation's `settle` seam at boot for a row with no outcome, before answering `interrupted`.

## 9. Order of building

1. Kernel: `duration`, the `background` field, detach at dispatch, `detaching` hook with the hand-off race, `end` sparing background, `interrupted`, receipt words; unit tests.
2. threads: table and migration, `OwedCalls`, the delivery driver and its boot walk; native-harness: hooks, ending words, `read_calls` merge; integration tests for acceptance 1, 2, 5.
3. Declarations by §14's rule; `nativeDoor`.
4. `wait_call`; acceptance 4.
5. Door detach in `invocation`, the MCP catalog's field; the parity test (acceptance 3).
6. Claims; close.

## 10. Contract

Additive. `Tool.duration`, `Operation.duration` and the `background` field are new and optional; a detached call's receipt is an answer (`Tagma-Outcome: answer`) whose `status` is `running`, which every declared answer union already admits through its open arm. `CallRecord.phase` gains `interrupted`; the app draws it. `wait_call` is a new operation. The receipt's and `read_calls`' words change to what now holds. A caller that relied on a long act answering in place passes `background: false`.

## 11. Stored data

One new machine-store table, `owed_call` (threads): `(run_id, tool_call_id)` key, `thread_id` referencing the thread row with cascade delete, `name`, `input`, `epoch`, `opened_at`, and the outcome's `ended_at`, `outcome` and `words`. Additive migration; no old row is read. A row lives from hand-off to acceptance, so the table holds what is owed now and nothing historical. A caller with no thread opens no row — nothing is owed to anybody — and its detached call lives in the live record only.

## 12. Who may do what

Unchanged: the verbs keep [[d4b695a7]] — a thread reaches its own thread's calls, the operator the project's. `wait_call` is judged the same way. `background` asks for nothing new: detaching changes when the caller hears the outcome, not what the call may do.

## 13. Long-lived things, races, cleanup

States of a row: opened → ended → deleted at acceptance (or at discharge by `wait_call`, or with its thread). Races: hand-off against the body's end (the end waits for the hand-off); delivery against `wait_call` (both take the row in a unit, the first wins, the other finds nothing owed); boot walk against new calls (the walk touches only other epochs); deletion against delivery (the notice finds no thread, the row is gone with it).

## 14. Bounded resources, and which acts are long

A background call holds one fiber and whatever its act holds; the act's own lane or pool bounds the machine (a compaction joins the one already going, inspections run on the worker pool). A row is one small record while owed; its words are bounded by the tool-output envelope. No separate ceiling.

**The rule that classifies an act, for every act present and future.** An act is long when this server does not bound its duration: it runs a child process whose length the server does not own (a build, a test, an inspection, a commit hook, a merge, a container, a worktree's setup or removal), goes over the network, waits on a model, or waits on another agent's run — or when its measured p95 over a week of real use passes 10 s. Judged by the tail under load, never the median: a caller cannot tell a quiet machine from a loaded one. Short: reads answered from the store, from memory or from git plumbing, and graph, settings and thread-row writes the store bounds. Waits (`wait_command`, `wait_terminal`, `read_output` with a wait) are waits by nature and stay short. A new act declares its class by this rule in its own declaration; a later measurement moves an act through that declaration.

The measurement behind it: native tool-call wall durations over 705 runlith threads, 2026-09-22 to 2026-09-29 (about 98,000 calls, bracketed at 1/5/10/20/30/120/300 s): `compact_agent` median 30–120 s, 18% past 120 s; `delete_worktree` median 30–120 s, 29% past 120 s; `fork_thread`, `create_worktree` and `submit_work` p90 20–30 s; `enforce_rule` 12.5% past 30 s; `submit_work`, `run_doctor` and `bash` with minute-long tails; `send_task` with `compact` never past 30 s. By the rule these are long: `compact_agent`, `fork_thread`, `webfetch`, `websearch`; `submit_work`, `merge_worktree`, `check_worktree_merge`, `open_worktree_pr`; `commit_checkout`, `push_checkout`, `fetch_checkout`, `pull_checkout`; `create_worktree`, `prepare_worktree`, `update_worktree`, `restore_worktree`, `delete_worktree`, `clean_up_worktrees`; `run_doctor`, `run_doctor_all`, `sync_graph`, `reanchor_path`, `resolve_graph_conflict`; `check_rules`, `enforce_rule`; `prepare_sandbox`, `build_prepared_tree`; `build_checkout`, `restart_server`, `vacuum_database`; `capture_performance_profile`, `capture_memory_reading`; `generate_thread_title`, `compact_thread`; `add_mcp_server`, `enable_mcp_server`; `refresh_accounts`, `complete_sign_in`. Each declaration is checked against its body when it is written; an act found store-bounded there stays short.

## 15. Rollout

A call already in the background when this build starts was held in the old process's memory and is lost as before; from this build on every hand-off is durable. Running agents see the field and the new defaults from their next turn's catalog.

## 16. Failures

Dropped connection: a detached door call runs in the calls' scope, not the request's. Restart: §4.8. Store failure at hand-off: refused, the call stays in the foreground. Store failure writing an outcome: the driver retries, and the boot walk settles the row `interrupted` with words that name both causes. A notice that cannot be delivered stays owed and is retried at boot. Concurrent hand-offs join one.

## As built (divergences, recorded at close)

- The long set declared differs from §14's list by reading each body: `prepare_worktree`, `update_worktree`, `build_checkout`, `compact_thread`, `add_mcp_server` and `enable_mcp_server` already hand their slow part to a fiber or a run and answer at once, so they stay short.
- The door-level detach lives in threads' `OwedCalls.detached` — the live record and the owed ledger are both threads' — and `invocation/detach.ts` supplies only the door's words for a refusal. The background field's helpers live in the kernel's `tool.ts`, the entry every module may import.
- The socket's own acts (`start_turn`, `compact_thread`, …) take no `background` field: each already answers once its turn or compaction is queued.
- A body-level refusal of a detached call (e.g. `run_doctor_all`'s `operator-only` to a thread) reaches the thread as the ending's words, not as the call's answer.
- `read_calls` merges the owed rows; the socket's `calls.subscribe` feed carries the live record only, where every owed row of this process also stands.
- Reversed on 2026-09-30 by the operator: the §4.3 default is gone — an absent `background` waits for every act, long ones included, and only `background: true` detaches ([[a71d757f]]). The long default had handed a commit hook's `tagma check`, run under a thread's grant, a receipt in place of its verdict and refused every agent commit.

## 17. Observability

`read_calls` lists every background call with its thread, run, tool, phase, start, end and — for a call no longer live — its row; the app's calls panel shows mode `Background` and the `Interrupted` phase; an undeliverable notice is logged with its thread; the delivery driver logs what the boot walk settled.
