---
id: 01a11c9a-6edb-7ed8-b517-60ae0f8d8726
title: "One meaning on every transport: states and acts from one RunStatus, a missing capability is one transport-cannot refusal"
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/external/Surface.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/Life.svelte
  - kind: file
    ref: apps/tagma/server/src/threads/ending.ts
---
Goal: a state and an act mean the same on every transport, because the core sets them. Transport only changes how an act runs. Where a capability is missing, the core answers with the same refusal, and the app never draws the control.

## States

Every state is a `RunStatus` field ([[9f3bb3f9]]) derived by `runStatusOf` from the core rows: run, `Questions`, inbox, ending. No transport derives it.

| State | Means on every transport | Diverges today |
|---|---|---|
| `idle` | no `running` run; a standing transport process is a row detail, not life | terminal: life is the process life, and `unknown` work shows as working ([[fe977076]]) |
| `working` | a run goes and is not parked | terminal: hook observations in the facet |
| `awaiting` | the run holds at least one open `Questions` question of any origin: `ask_user`, approval, vendor question, screen widget | four question stores; terminal and `acp` read `facet.question` |
| `stalled` | the run goes, is not parked, and shows no durable movement longer than its transport's longest possible call | for externals `stalledSince` is always `null`; `list_agents` loses stall even for native (`store/directory.ts:147,160`) |
| ownership `held`, `stale-evidence`, `recovering` | by the core run's lease | the terminal has its own facet lease |
| `completed`, `failed`, `aborted`, `cut`, `withdrawn` | the core's ending, written by one terminal-transition owner ([[7e9130bd]]) | terminal: the process session's `outcome` |

Movement counts as `recorded`, `measured`, and any durable adapter report:
- on the terminal — every hook event;
- on `acp` — every boundary and `usage_update`.

**Threshold.** Today it is `max(AGENT_IDLE_MS × 2, CALL_ENVELOPE_MS)` = 20 min: a native call is bounded by the envelope, so a live run never stands still that long without movement. A vendor tool call has no such envelope, and a call with no events can run longer. So the threshold is `max(AGENT_IDLE_MS × 2, callEnvelope)`, where `callEnvelope` is declared by the transport: native — `CALL_ENVELOPE_MS`, a vendor profile — its CLI's longest call by measurement ([[a621fbb3]], T4). The meaning is one: `stalled` means the run stays silent longer than any of its calls may go. With no vendor limit (`callEnvelope: none`), its run never ages into `stalled`, and the thread row says so.

The threshold reads from the row's capability snapshot. The `state: stalled` list filter (`list/select.ts:181`, `list/wire.ts:174`) picks running runs by status index and compares each threshold, so its cost scales with running runs, not threads.

## Acts

| User act | Core act and answer | native | `acp`, Claude runner | `acp`, Devin | `terminal` |
|---|---|---|---|---|---|
| Enter, free thread | open a run → `started` | loop | prompt | prompt | print at the prompt or start the process |
| Enter, run going | `steer: step` → `steered`, else follow-up → `queued` | steer | steer | follow-up | follow-up |
| Tab | follow-up → `queued` | ✓ | ✓ | ✓ | ✓ |
| word recall | never handed over — dropped from inbox; a handed steer → `withdraw` or `withdraw-failed` | dropped | `_tagma/withdraw` | — | dropped |
| Stop, `stop_run`, `stop_agent` | stop the run → `aborted` | abort | `session/cancel` | `session/cancel` | by the profile's `interrupt` |
| Stop with withdraw | stop and drop the run's visible entries; needs `history` | ✓ | session cut on the next launch ([[66a5c66e]]) | `transport-cannot` | `transport-cannot` |
| interrupt task from an agent | stop the run and queue a task | ✓ | ✓ | ✓ | ✓ |
| question answer | `Questions.answer`; the vendor answer is `TransportAsks.answer` | ✓ | ✓ | ✓ | ✓ |
| bypass-mode switch | `onEnter` of the mode resolves open approvals of every origin ([[bb429da3]]) | ✓ | ✓ | ✓ | ✓ |
| `continue_thread` | continue an interrupted run; with no awaiting words it needs `continue` | ✓ | ✓ | `transport-cannot` | `transport-cannot` |
| rewind, fork | `history` | journal | session | `transport-cannot` | `transport-cannot` |
| `/compact`, threshold | `compaction` | core | session | `transport-cannot` | `transport-cannot` |
| model change | `modelMove` | live | live ([[4010a731]]) | live ([[4010a731]]) | `model-pinned` |
| archive, delete | stop subtree runs in core; `release` the process | ✓ | ✓ | ✓ | ✓ |
| transport change | no run; `release`; new binding; `declared` | — | ✓ | ✓ | ✓ |

Value summary:
- Every `transport-cannot` cell refuses with one code naming the capability.
- Keyed replay (`admit` with a client key) works on every transport, because every door enters one `admit`. Today the external `send`, `queue`, and `steer` implementations ignore the key (`contribution.ts:62-77`), `withExternalRuns.start` and `continue` always answer `acted: true`, and `stop` loses key and `by`.
- Stop is a core act: it writes `stoppedBy`, so a report never goes to the stopping parent, as on native, and sweeps the run's commands and calls (`sweepRun`) on every run. The external branch returns before it today (`ending.ts:77-83`).
- The parent report is one per run, from the settlement outbox, with the run's last message. On the terminal it is the Stop-hook or vendor-transcript message written to the journal ([[a621fbb3]]). It never closes a request on any transport: only an explicit final answer closes a request.
- The report text reads the capability snapshot. A `cut` report advises continuing the thread only on `continue`, else sending words to start again. A `completed` report with `end-unobserved` says the turn end was derived, not seen, and there is no last message.
- A parent learns of a child's question from the `awaiting` stage and the approver route ([[52a9ca4e]]). No `envelope:ask` is ever sent to anyone.
- Every question is answered by one `answer_question` operation, with a refusal for a refusal. `answer_ask` and `cancel_ask`, which today exist only for external threads (`threads/turns/asks.ts`), go away: there are no questions outside `Questions`.
- Archiving one thread stops every running run of the subtree except its archiver's line and frees adapter resources. Batched archive leaves threads with a running run unarchived. "Running" is `RunStatus`, not process rest. Three rules today (`threadList.ts:398-448`, `ending.ts:121-127`).
- A child's birth text is one for all: the model row comes from the core choice, and the collaboration block from the `messaging` capability (today both branch on `child.harness === NATIVE_HARNESS`).

## Visible changes

1. A terminal thread's life is its turns. "Work unmeasured" no longer shows as working: with no observed turn the thread is `idle`, and the process shows in the row. The other side: a CLI that kept working after resume with no new prompt shows `idle` until its turn's event arrives — then an `observed` run opens. A word sent in between waits at the prompt: `launch` prints it when the CLI can take input.
2. A terminal-CLI turn whose Stop Tagma never got ends on the next evidence by the vendor transcript: `aborted` when read that the operator interrupted it in the TUI, else `completed` with the closing message or with no message and the cause "turn end unobserved" ([[a621fbb3]]). The thread row names what each profile's end may miss.
3. A model switched directly in the TUI between turns shows from the next turn.
4. Stall shows on `acp`, on the terminal, and in `list_agents` for all.
5. A terminal thread has a feed in the journal: user words, tool calls from hooks, the closing answer. So the "said" row, title, and search work. Recap on the terminal is manual only, retelling the journal: it has no warm copy ([[45d13bf3]]). The row names the completeness as the `feed` capability.
6. A terminal thread's follow-up is a separate run with its own report, printed at the prompt after the turn end. Today it continues the same "session run" via the Stop-hook answer.
7. No `envelope:ask` message to a parent on any transport.
8. `stop_agent` on an external thread stops the run, not the process. With `interrupt: resource` the process ends too, and the row says so.
9. Withdraw and `continue_thread` on an external thread answer by capabilities instead of silently doing otherwise. Today withdraw on `acp` is lost (`ending.ts:77-83`), and `continue` raises a process.
10. Several concurrent vendor questions are several questions. The facet slot is gone. The `answer_ask` and `cancel_ask` operations go: `answer_question` answers.
11. Words delivered with no read acknowledgement never enter any transport's run-end report. The sender gets the report from the run that read them, or once when reading stayed unconfirmed past the read deadline or to the agent process's end. Today they enter the first end.
12. After two launch failures in a row the thread never retries on its own: the row says launch is blocked, and a new word retries.
13. A terminal-CLI turn's answer no longer closes the parent request: only an explicit final answer closes it, as on native and `acp`.

## App surface

- A thread on `terminal` opens the terminal, as today. The chat over the thread's journal is an extra view behind a setting. The surface reads the `screen` capability, not the transport name (`Surface.svelte.ts:17`).
- The thread row, awaiting-word chips, the question window, Stop, and model choice read `RunStatus`, snapshot, and the capability snapshot — the same for all. A control with no capability never draws.
- `rowLife.ts` and `harnessAttention` go away in the app: the client never derives life ([[51c66cb6]], [[c3436715]]).
- The row names the transport and its weakenings (`feed`, `law`, `touch`, `authorship`, `usage`, `aside`), as it names `proves` today.

## Acceptance criteria

The performer proves it with the transport parity suite. One scenario set runs on three adapters with a scripted vendor:
- native with a fake provider;
- `acp` with a scripted agent (`testing/acpAgent.ts`) in `tools: tagma` and `tools: vendor` profiles;
- `terminal` with a scripted hook sequence and a fake PTY.

Per scenario it compares:
- the `RunStatus` sequence: `life`, `stage`, `openQuestions`, `ending`;
- each run's journal entry kinds;
- inbox fates;
- the parent-report count, kind, and content;
- answer codes.

Scenarios:
1. a word into a free thread;
2. a word mid-turn;
3. Tab;
4. recall of an unhanded and a handed word;
5. Stop and Stop with withdraw;
6. an interrupt task;
7. a question: answer, deadline, bypass;
8. process death mid-turn;
9. a server restart mid-turn and mid-question — handover and crash alike;
10. rewind, fork, compact, model change;
11. keyed replay of every door.

Where capabilities match, observations match. Where they do not — one `transport-cannot` or the table's declared behavior.

The operator hand-checks the root scenario: four threads, one sequence, matching rows.

## Decided by the operator

1. **Only an explicit final answer closes a parent request** (`send_message final: true`), on every transport. A run end, including a terminal-CLI turn end, never closes a request: its report carries the last message, and the request stays open. An external CLI sends a final answer via MCP Tagma.
2. **A thread on `terminal` opens the terminal**, as today. The chat over the thread journal is an extra view behind a setting. The core row, journal, and runs of a terminal thread stand under any view.
