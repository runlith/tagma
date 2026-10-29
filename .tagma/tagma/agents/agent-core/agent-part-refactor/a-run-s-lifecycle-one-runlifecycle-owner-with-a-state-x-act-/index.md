---
id: 01a118eb-3e7e-7085-8f2e-2ccf7e9130bd
title: "A run's lifecycle: one RunLifecycle owner with a state x act table and observable outcomes"
ord: 5
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/agent/src/thread/run/ThreadRunLease.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadRunLedger.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadRunReaper.ts
---
Goal: a run has one lifecycle owner — `RunLifecycle`. It decides every transition under the contract below: who may, under what ownership and expected run id, what is recorded durable. The reasoning "what ends a run and who may do it" reads in one place, and every outcome, including exhausted settlement delivery, is a typed outcome somebody reads.

## Now

Transitions are decided in four places:
- `ThreadRunLease` — abort vs fail on `AbortSignal`. The transitional state (`startingRuns`, `runAborts`, `stopIntents`, `withdrawIntents`, `departing`) is recorded by no row.
- `ThreadRunReaper` — adopt vs cut by time gaps.
- `ThreadRunLedger` — writes, including handover (`ThreadRunLedger.ts:126`).
- Claim SQL predicates (`native-harness/runs/reaping.ts:180-236`) — by owner, heartbeat age, current run.

Gaps:
- **Settlement.** Subscribers run in sequence (`ThreadRunSettlements.ts:35-39`), and a retry restarts all leaders from the top: there is no per-subscriber completion cursor. After the attempt cap, SQL stops selecting the row (`reaping.ts:263-268`). `lastFailure` persists (`ThreadSettlementOutbox.ts:142-157`), but exhaustion is no outcome anyone reads except the log.
- **Resume.** A resume failure folds into a `lost` catch-all with a log entry (`ThreadRunReaper.ts:297-315`). "Execution fell over" vs "ownership lost" is erased.
- **Heartbeat.** The tripwire skips `onBeatLapsed` (`ThreadRunLease.ts:653-687`) with no production subscriber. It is a stale heartbeat-evidence signal, not proven ownership loss and not progress stall. Stall by durable-movement age is derived separately (`Commands.ts:495-519`).
- **Admission.** `runAdmission.ts:1-3` holds a module-global `Map`.

## Transition contract

Row states (`ThreadRunStatus`): `running` and terminal `completed`, `failed`, `aborted`, `cut`. `running` has sub-states recorded in the row:
- running under an owner — `ownerId`, fresh heartbeat;
- parked on a question — `awaiting-question` stage, no execution;
- resuming — `resuming` stage;
- handed over — `handedOverAt` set, owner leaving.

| Act | From | Condition | To | Durable effect |
|---|---|---|---|---|
| `create` | no run or terminal | thread has no `running`; `startKey` new | `running`, creator owns | row, consumed inbox items, key |
| `continue` | `cut`, `aborted`, or `failed` | thread's newest run | new `running` via `create` | link to the continued run |
| `beat` | `running` | owner is the caller, expected run id | `running` | heartbeat only |
| `progress` | `running` | owner, expected run id | `running` | recorded progress, usage, or thread tail; durable movement resets the crash-resume count (`runs/ledger.ts:387-424`) |
| `park` | `running` running | owner, question open | `awaiting-question` | question ([[fb39e560]]), execution freed |
| `resume` | `awaiting-question` | question answered or expired; any process | `resuming` → running under a new owner | answer, owner |
| `complete` / `fail` | `running` running | owner, expected run id | `completed` / `failed` | settlement transaction: closed parts, ending, `run-end` ([[c3436715]]) |
| `stop` | `running` | any caller with thread rights; `settledBy` | `aborted` | ending; on withdraw intent and a turn passing the `withdrawableTurn` check (`ThreadRunLedger.ts:581`), a withdraw event ([[c3436715]]) |
| `handover` | `running` running | owner leaves (shutdown), `handedOverAt` empty; a standing stop is no obstacle — the new owner's reaper ends such a run at once with that stop instead of waiting out the takeover threshold | `running` handed over | `handedOverAt` |
| `adopt` (handed over) | `running` handed over | owner differs; no resume limit | `running` under the new owner | owner, `handedOverAt` cleared, `resumes` unchanged |
| `adopt` (abandoned) | `running` under a foreign owner, `handedOverAt` empty, heartbeat older than the takeover threshold | `resumes < maxResumes` | `running` under the new owner | owner, `resumes + 1` |
| `cut` | `running` handed over or abandoned | resume refused, exhausted, or run not resumable | `cut` | ending with cause, notification seeded |
| `reap` | `running` under its own owner with a heartbeat older than the threshold | this process's lease does not hold the run (else `reap-declined`) | `failed` | ending "run stopped reporting progress", notification seeded |

Neither `adopt`, `cut`, nor `reap` touches a run in `awaiting-question`: only `resume` continues it. A hosted run adopts on its own road.

Norms:
- Keyed replay returns the earlier result with no transition; the fresh-`create` precondition does not apply to replay. A fresh `create` opens exactly one new run. A key with different content is a typed conflict.
- An act outside the contract refuses with a typed error carrying state and act.
- The code shape (data table or function) follows simplicity; one owner decides the transition.
- The adapter atomically persists transition conditions and owner fencing. Conformance checks domain outcomes, including the stop/complete race, two opens, post-crash repeat, handover with adopt.

## What gets built

- `thread/run/lifecycle`: `RunLifecycle` with the contract above. Stop and withdraw intents are recorded acts, not lease fields.
- `RunExecution` — a narrowed lease: start in process, batched per-process heartbeat, stop, takeover; no transition decisions.
- Reaper decisions are the `adopt`, `cut`, and `reap` acts. A resume failure is the typed `resume-failed` outcome, distinct from `ownership-lost`, in activity.
- **Durable ending.** `RunEnded` (`thread/ending.ts`) is written once by the terminal-transition owner, in the terminal transaction. `endings` reads with `limit`, `total`, and a stable cursor survive a restart.
- **Notification delivery** (outbox) is a separate state of the same ending, readable by whoever already saw the end:
  - a per-subscriber completion cursor, so a retry never re-runs the finished;
  - every subscriber idempotent by run key;
  - exhaustion is the explicit `notification-exhausted` state with the last cause, visible in activity and in the ending read;
  - re-taken by an explicit act.
- **Signals.** Progress stall, stale heartbeat evidence, and recovery are three separate signals for `RunStatus` ([[9f3bb3f9]]). A missed heartbeat is only stale evidence: ownership loss is claimed. `onBeatLapsed` connects to the stale-evidence signal in the same change ([[a00f91b0]]) or is removed.
- `ApprovalParking` — one parking deadline machine; the question side is in [[fb39e560]]. The mode-law cache moves to `modes/` ([[bb429da3]]).
- `runAdmission` is a service with its own Layer.
- **Migration.** Rows in flight (running, parked, unacknowledged notifications) migrate onto the new intent and cursor entries with no loss of open questions, completed effects, or replay keys.

## Acceptance criteria

- Conformance on both adapters for every contract row: the allowed transition and its durable effect, refusal outside the condition, stop/complete and double-open races, repeat with a different-content key, handover → adopt with no resume count, abandoned → adopt with a count and exhausted → cut, own old → reap into `failed`, parked untouched by all three; heartbeat alone with no durable progress never resets the crash-resume count, while durable progress resets it.
- Settlement test:
  - first subscriber done, second failed — the retry never calls the first;
  - a crash between effect and acknowledgement retries idempotently;
  - after the cap, `notification-exhausted` is visible in the ending read to a reader that already saw the end.
- Reaper test: resume failure and ownership loss are different typed outcomes.
- Isolation test: two harnesses in one process never see each other's admission.
- Migration test: a store with a parked run and an unacknowledged notification resumes and delivers after migration with no repeated effects.
- `ThreadRunLease` successors hold no intent fields; no file over 650 lines without import; the debt entry goes away.
