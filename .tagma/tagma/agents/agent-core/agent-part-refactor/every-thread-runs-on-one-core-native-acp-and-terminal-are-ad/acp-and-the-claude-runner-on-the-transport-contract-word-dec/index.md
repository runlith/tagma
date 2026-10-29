---
id: 01a11c9a-6edb-7ed8-b517-60af35a07ee2
title: "ACP and the Claude runner on the transport contract: word decisions at the scheduler, second journal writer and hosted ports deleted"
ord: 3
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/inputs.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/journal.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/transport.ts
---
Goal: the ACP driver is an `acp` adapter of the core contract ([[2121a95f]]) for both profiles: the Claude runner (`tools: tagma`) and Devin (`tools: vendor`). Word decisions and the next run move to `RunScheduler`. Hosted ports, the second journal writer, and the facet question slot disappear. Wire, client machine, protocol row, and the "write before bytes" order stay with the driver ([[16a4c8ac]], [[e47bd3fc]]).

## Now

- **A run is a core run, but through side ports.**
  - The driver opens it itself: a step writes `step.started`, and `HarnessRuns` → `hosted.begin` → `scheduler.admit({ kind: 'hosted', tx })` (`threads/harness/turns.ts:204-215`, `scheduler/hostedLedger.ts:34-39`).
  - The end goes through `hosted.end` outside the step's write. Until the ledger closes the run, the row holds `ending`, and words wait for `ProtocolReactor.flushed` with a short deadline ([[e47bd3fc]]).
- **Word decisions sit with the driver.** Under the connection lock (`protocol/inputs.ts:189-225`) it picks steer or follow-up by `readsMidTurn` and opens the next run itself: steers after Esc first, follow-ups and the compaction barrier after them ([[fb0b1868]]). The core's follow-up wake is off for such threads (`unhosted`).
- **Journal, live tail, and context reading** are written by `threads/harness/turns.ts`: its own transition plan (`:232-267`), its own part map `streams` (`:203`), a direct `update thread set contextReading` (`:223-231`).
- **Vendor questions** are one `facet.question` slot (`source: 'protocol'`) plus a row queue. Answers travel through the `contribution.ts` branch on `facet.question.source`.
- **Hosted edges.** `HostedCalls.introduced` and `HostedAwaiting.changed` go through the `threads/harness/hosted.ts` proxies, which read the facet on every call.
- **Heartbeat.** Every connection spins its own heartbeat (`protocol/process.ts:220-266`): it rewrites the facet and calls `alive` every 5 s, including on an idling process.
- **Recovery** is a scan of `json_extract(facet, '$.transport') = 'acp'` over all rows (`store/sessions.ts:282-297`, `protocol/attendance.ts:104-113`).

## Goal

**Opening.**
1. The scheduler opens the run with the consumed inbox items and commits.
2. After commit, `launch` writes a pending prompt request with the item ids into the protocol row under the connection lock — the same `saved` step as today — and queues frames in the writer ([[6bfa7543]]). With no process, first start plus `session/load` or `session/resume`.
3. A run opened before a server crash, with no request in its row, is launched by `adopt` the same way, once.

`Admitted`, `Unwritten`, and `Unknown` receipts stay the driver's machine. It reports word fates with the `fate` report:
- write refusal → `returned` plus `ended(failed)` with the `launch` cause;
- uncertainty → `unconfirmed`;
- an agent answer to a prompt — with `stopReason` or its updates — proves reading: the driver reports `fate(read)` for that prompt's items in the same write as the run end, including after `Unknown`.

An unconfirmed item's read deadline on `acp` is the profile's unresolved-prompt grace ([[2121a95f]]).

The driver takes the first-prompt lead (orientation, team law, recap) from `RunGuidance` in `launch`; it neither builds the lead itself nor stores law in the protocol row ([[2121a95f]]).

**Words mid-run.**
- The profile declares `steer: step`. If the agent did not advertise `_tagma/steer` or `_session/steering` in `initialize`, `declared` removes the capability.
- A compaction run does not take steer, by core rule — same as native compaction.
- The scheduler decides and writes the steer, then calls `deliver`. The driver hands each item over with its own `_tagma/steer` under claim, as today, and reports `fate(read)` on echo and `fate(returned)` on `promptRequired` or after the run end. Revocation goes through `withdraw` (`_tagma/withdraw`).
- The driver holds no "which record to write" branch.

**Next run.** The core's follow-up wake opens it, the same as native: steers after `aborted` first, then the compaction barrier, then follow-up. `unhosted`, `ProtocolReactor.flushed`, and the row's `ending` state go away: a run end is one write holding the protocol row and the core's terminal transition (`ended`). That requires `RunLifecycle.finish` and `stop` to take the driver's write ([[2121a95f]]). No new run opens while the finished run still holds live steers ([[fb0b1868]]): the driver reports their fate in the same write as the end or in a following report. The scheduler opens the next run only after every delivered word of the past run has a fate.

**Journal and live tail.**
- Update projection yields `recorded` with typed records, `measured` on every model request, and `live` with core deltas ([[424c0878]], [[8dd27b1e]]). Dedup of Tagma-executed calls (`_meta['tagma/executes']`, [[ae10d61d]]) stays in the projection.
- Context reading from `usage_update` ([[c7d3d8a2]]) is the `measured` report's `reading` field, written by the core.

**The `tools: tagma` profile (Claude runner).**
- `ThreadHosting` stays a core service: run assembly, door, step rules, and history through `open_hosted_turn`, `call_hosted_tool`, and `read_hosted_history` ([[8e0f35a1]]). It takes the agent from the core row's `binding.agent`, not from `facet.hosts` (`hostedOperations.ts:22-33`).
- Its questions are `Questions` ([[fb39e560]], [[7c54d3ed]]).
- The core publishes the wait at parking. Before writing the stage the core calls `reached(run, now)`, the driver seals the unfinished message into the journal ([[3b671eda]]), and the core closes the live tail's open parts, as `HarnessRuns.waiting(false)` does today (`threads/harness/turns.ts:374-384`). The next delta after the answer opens a new part, so no separate wait-removal signal exists.
- An instrument result waits for `reached(run, { call })` instead of `HostedCalls.introduced`.
- `reached` is called under the `ThreadHosting` semaphore and takes only the connection lock. Under the connection lock the driver never waits for `ThreadHosting`.

**Vendor questions** (root cut 2).
- `request_permission` is judged by judge ([[4a024c48]]). `allow` becomes `allow_once` immediately. `ask` becomes `asked(run, question)` in `Questions` keyed by request id.
- The answer travels `TransportAsks.answer`, and the driver maps it to `optionId` by today's rules. `allow_always` is never picked (decision 5 [[adb9cd5b]]).
- Simultaneous requests are separate questions.
- A run cancel answers pending requests `cancelled`, and the core closes questions with the run end.
- A vendor choice Tagma never asked about (`agent-choice`) is also a `Questions` question with an adapter route. The `facet.question` slot is deleted.

**Compaction** (`compaction: session`).
- The moment (context-reading threshold or manual request) and the inbox barrier are decided by the core, as with native.
- The core opens a `compaction` run and calls `TransportCompaction.compact`; the driver sends `_tagma/compact`.
- The `compaction` boundary arrives as a `recorded` report, the end as `ended`. The driver no longer holds the barrier or the hosted compaction run ([[92391518]]).

**History** (`history: session`). Rewind and Stop-with-withdraw are core acts over the journal; the driver takes no part. The next `launch` compares `protocol_turn` against the journal and, if runs left history, cuts the vendor session with `_tagma/rewind` before the prompt or rebuilds it from the journal ([[66a5c66e]]). Restore is `TransportHistory.restore` (reset only once the cut is executed), foreign compaction is `reset`, fork is `TransportHistory.fork` inside the child-birth transaction. The `protocol_turn` cuts stay with the driver ([[e47bd3fc]]).

**Restart.**
- The core's reaper calls `adopt(run)`. Only `adopt` raises a connection whose run the dead owner held: the driver re-reads stdout from the cursor and answers `adopted`; with no process it answers `declined`, and the core cuts the run per the [[7e9130bd]] table. The cursor moves only after an accepted plan, so frames read before `adopt` are not lost. A runless connection rises lazily, on the next `launch`.
- Handover on clean shutdown is the core's shared handover; `depart` is deleted.
- A parked run is untouched by the reaper. An answer arriving after a restart is delivered by `TransportAsks.answer`. If the process died meanwhile, the driver reports `ended(failed)` with the process cause — as on process death with a live server (`protocol/process.ts`).
- A standing process's end with no run is observed by the driver through a host event (`TransportResource.watch`).

**Signs of life.** Runs are beaten by the core's one beater per owner via the drivers' `holds`. Resource leases are written by the driver as one record per tick ([[570382ca]]). No per-connection heartbeat fiber remains. The unresolved-prompt grace is checked on the driver's tick.

## What gets deleted

- `packages/agent`:
  - `ThreadHostedRuns`, `HostedRuns`, `HostedRunLedger`, `scheduler/hostedLedger.ts`, `unhosted`;
  - the `hosted` kind in `RunInput`;
  - the `HostedAwaiting`, `HostedCalls`, `HostedHistory` ports.
- `threads`:
  - `harness/hosted.ts`, `harness/turns.ts`;
  - `contract/service/harnessTurns.ts`, `harnessJournal.ts`, `harnessRuns.ts`, `harnessStream.ts`.
- `external-harnesses`:
  - in `ProtocolSessions`: `queue`, `steer`, `unqueue`, `current`, `answer`, `cancel`, `adopt`, `awaiting`, `introduced` — the contract's subjects do their work;
  - the decision in `ProtocolInputs.admitted`;
  - the "what to send next" choice in `prompts.ts`: `launch(seed)` remains;
  - lead assembly and the protocol row's `law` field;
  - `link.profile.hosts !== null` checks: the profile's `tools: 'tagma' | 'vendor'` field replaces them;
  - `ProtocolReactor.flushed` and the row `ending`;
  - `ProtocolAsks` as facet parking;
  - the connection heartbeat fiber;
  - the `standing('acp')` scan.

## Acceptance criteria

The implementer proves on a scripted ACP agent:
- Races:
  - Enter at the moment of the agent's answer to a prompt — the word lands in exactly one run;
  - a steer delivered into a finished run returns and opens a follow-up;
  - Esc with unread steers — they open their run before the follow-up.
- A crash between run opening and `launch` — the prompt goes out once after `adopt`; after `Unknown` — `unconfirmed` with no repeat.
- A new word's `admit` while the driver reports a run step under the connection lock — no deadlock, no lost word.
- Two simultaneous `request_permission` calls — two questions, answers travel by their own ids; cancel answers both `cancelled`.
- `tools: tagma`:
  - an instrument result never reaches the journal before its call;
  - parking publishes `awaiting` after the sealed message;
  - the answer resumes the feed with no loss and no duplicate.
- `session` compaction opens from the core, the core's inbox barrier holds, words past the barrier go after it.
- A restart mid-run and mid-question: `adopt`, the answer is delivered, the feed has no holes.
- The existing protocol system tests (`protocolWords.stest.ts`, `protocolMethods.stest.ts`, compactions) pass with no change to visible-behavior assertions. Only internal-port assertions change.
- `rg`: the "What gets deleted" list is empty.
