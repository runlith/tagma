---
id: 01a14cba-e095-7bcb-bb6f-608666a5c66e
title: "Rewind and withdraw on Claude on ACP answer at once: the journal is the single truth about the cut, the next launch brings the vendor session to it"
ord: 6
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a10933-6ba7-7d05-bef5-c412e47bd3fc
  - kind: relates
    to: 01a11c9a-6edb-7ed8-b517-60af35a07ee2
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/history.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadRewind.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadStopping.ts
---
Goal: rewind "from the turn" and Stop with withdraw on Claude on `acp` answer as immediately as on native, and never raise the vendor process. The vendor session is brought to the journal on the next launch. The cut is derived from the journal, never held as a reserve, so a crash at any point leaves neither a stuck nor an illegal cut.

## Now

`ThreadRewind.rewind` calls three `TransportHistory` phases, with no shared record between them:
1. `hosted.rewind` (`ProtocolHistory.rewinding`):
   - reserves `row.rewind` in the protocol row;
   - raises the process via `attendance.ready` and waits up to 60 s for the session to open;
   - sends `Cancel` to the live turn itself;
   - sends `_tagma/rewind` and waits for the new conversation id.
2. The core cuts the journal in a separate record (`ThreadRewind.ts`, `settle`).
3. After `RunAdmission` — `hosted.rewound`: trims `protocol_turn`, sets the new `sessionKey`, drops the reserve. On a failure in the process — `release`.

Consequences:
- The user waits for the process start and resume, and an hour-idle thread always pays for it ([[570382ca]]).
- A server crash between 1 and 2 leaves a reserve with an uncut journal. A crash between 2 and 3 leaves a cut journal with an undropped reserve. No automatic recovery, only a repeat of the same keyed door.
- While the reserve stands, everything else refuses: another rewind ("Another rewind … has not finished"), fork ("being rewound"), restore (`thread-running`), prompt (`prompting`).

## Why the vendor session is cut, not assembled from the journal

- **Cutting in the vendor session keeps its prefix**, with it the warm prompt cache and Claude Code's own record of calls and results. Assembling a new session from the journal (`transcript.ts`, [[d0810682]]) costs a full cache write. If this `claude` version cannot read the assembled file, the history leaves as a text retelling.
- **Claude Code's cut is lazy by construction.** `_tagma/rewind` opens a query with `resume`, `forkSession` and `resumeSessionAt`, and the fork file is written only by the first message ([[d0810682]]). Doing it at rewind time only buys a process start: the cache win appears only with the next prompt.
- **A fork never destroys the source session.** Repeating `_tagma/rewind` from the same `sessionKey` is safe. The recovery below rests on this.

Decided from the code: there was no recorded reason.

## Solution

### The journal is the single truth about the cut

Rewind is one core act: `ThreadRewind.rewind` cuts the journal with a `rewind` record and stops the live turn itself (`stopGoing`, `marker`, [[45d13bf3]]), as on native. The transport takes no part in the act: `TransportHistory` loses `rewind`, `rewound` and `release`, and the protocol row loses `rewind`. `restore`, `reset` and `fork` stay.

`protocol_turn` rows record which Tagma turns sit in the vendor session and with which prompt uuid. A new session the runner assembles from the journal receives rows for every standing journal run with no uuid (`ProtocolRows.based`, in the same record as `session/new`): without them a rewind of a turn the session got from the journal would find no row, and the cut would be lost. The cut is the diff of the rows against the journal:
- **cut runs** are known to journal attribution: a run whose records a rewind holds (`heldBy`), or one dropped (`withdrawn`). The core hands them out through the transport contract's `JournalRuns` port (`cut` — cut runs, `kept` — standing runs with messages for the new session's rows; implemented by `ThreadAttributions`, on the adapter by `harness.runs.history()`); the adapter reads the core, the core never knows the adapter ([[e090f46d]]). Attribution is incremental and held in memory, so each launch read does not re-read the journal;
- **the cut point** (`ProtocolRows.point`) is the earliest row of a cut run. It is cut with `_tagma/rewind` only when rows stand before it, it has a uuid, and no standing-run rows stand after it. Otherwise — a first-turn rewind, a turn from the journal, or one turn mid-session — the session is assembled from the journal again: the vendor fork keeps only the prefix.

Stop with withdraw ([[0f8d8726]]) follows the same road. Today `ThreadStopping` calls `history.rewind` around the stop, then `rewound` or `release` by the run status. Now it only stops the run with `withdraw`: a `withdrawn` run gives a cut point, an `aborted` one (withdraw never happened) does not.

### `launch` brings the session to the journal

Before `session/prompt` and before `_tagma/compact` after a turn, `ProtocolAlignment.align` (`protocol/alignment.ts`) brings the session to the core, ahead of `Configure` ([[4010a731]]):
1. The driver reads the cut point.
2. No point — the launch continues.
3. A point with no `_tagma/rewind` (see below) or an agent that never declared the extension: `session/new` in the same process; the same record replaces the `protocol_turn` rows with standing-run rows and drops `sessionKey` ([[e47bd3fc]]): otherwise a crash before the answer would leave the old session with the new session's rows.
4. Otherwise the driver sends `_tagma/rewind { sessionId, turn: prompt }` from the current `sessionKey` and writes `cut { at, request }` into the protocol row. This is no reserve: nothing refuses on it, only the next launch reads it, so it never sends a second request while the first is in flight.
5. The answer (the `rewind` declaration in `methods/fork.ts`) issues `SessionReady` with the new id and session settings. `settledFacet` sets `sessionKey`, `binding.rootKey` and `configured` from it, and the driver step in the same record trims `protocol_turn` from the `at` row and drops `cut`.
6. A cut refusal leaves `cut { at, request: null }`: the next launch to the same point opens a new session from the journal, as in 3, and the turn runs. A `session/load` or `resume` refusal ends the session with a refusal, as before, except "the agent holds no such session" — then a new session: losing the conversation to a transient agent-store failure is worse than waiting.
7. A row with no `sessionKey` in the ready phase also opens a new session in the same process.

### Recovery and act composition

Every crash window reduces to "the cut point is still visible":

| Crash | What the next `launch` sees | Outcome |
|---|---|---|
| before the journal record | journal uncut, no point | nothing is cut |
| after the journal record, before `launch` | point stands | cut at launch |
| after `_tagma/rewind` sent, before the answer record | point stands: `protocol_turn` untrimmed, `sessionKey` old | repeat from the old session; the abandoned vendor fork is read by nobody |
| after the answer record | no point | nothing is cut |

Acts between rewind and the next prompt are ordinary journal acts:
- **a second rewind** cuts the journal again, and the point is the earliest cut turn, so both cuts leave in one `_tagma/rewind`;
- **restore** returns runs to the journal, and the point disappears or retreats. `TransportHistory.restore(thread, runIds)` under the reactor lock does nothing while every returned run has a row and no cut is in flight; when a row is missing or `_tagma/rewind` is already sent (its answer would have trimmed the returned turns) (the cut is already executed), it stops the process as before, forgets the rows and drops `sessionKey`. A compaction by someone else calls `reset` — same with no condition;
- **fork** — the child prefix is taken before the first turn that is not in the child or is cut in the source journal: the same `ProtocolRows.point` over rows before the `before` turn, in the child's birth record; when an uncut row stands between the earliest cut row and the fork point, there is no prefix and the child is assembled from the journal. The "being rewound" check is removed;
- **a transport change** — the new road reads the already-cut journal; the old session's rows leave with its `release`.

First-turn rewind, a "last N turns" fork, turn deletion and restore after an executed cut still lead to a new session from the journal ([[e47bd3fc]]).

Sessions opened before this work have no standing-run rows. The `aligned_launch` migration drops `sessionKey` on idle Claude sessions on `acp`, and their next turn assembles the session from the journal once. A session whose process ran through the upgrade has no rows until its next new session: a rewind of a turn it got from the journal does not cut it until then.

This changes the "History" paragraph in [[35a07ee2]] and the `TransportHistory` section in [[2121a95f]] in the same act, and after the code — the [[e47bd3fc]] note.

## What is removed

- `TransportHistory.rewind`, `rewound`, `release` and their calls in `ThreadRewind` and `ThreadStopping`;
- `row.rewind`, `ProtocolHistory.rewinding`, `attendance.ready`, the wait for `phase === 'ready'`, the driver's own `Cancel` and the wait for a new id at rewind time;
- the `session-rewind-failed` and `session-uncertain` refusals of this road;
- the `row.rewind` checks in `fork`, `restore` and `prompting`.

## Acceptance criteria

The implementer proves:
- **Parity suite.** A rewind "from the turn" on a thread whose process is stopped answers with no process start, and the journal is cut as on native. The next word raises the process: the first frame after opening is `_tagma/rewind`, then the prompt, and the vendor conversation holds no cut turns.
- **Protocol system test, crash windows** — one row of the table above each:
  - crash before the journal record: prompt with no `_tagma/rewind`;
  - crash after the journal record: one `_tagma/rewind` before the prompt;
  - crash after `_tagma/rewind` sent before the answer record: repeat from the old `sessionKey`, the turn runs;
  - crash after the answer: prompt with no cut.
- **Protocol system test, composition:**
  - two rewinds in a row before the prompt — one `_tagma/rewind` to the earlier turn;
  - rewind, then restore before the prompt — no cut;
  - rewind, then fork before the prompt — the child with no cut turns, and the source cut by its own launch;
  - rewind on a live turn stops it via the core exactly once.
- **A cut refusal** at launch gives a new session from the journal, and the turn runs.
- **Stop with withdraw** passes the existing `protocolStops.stest.ts` with no changed visible assertion; a server crash between the stop and the next prompt leaves no dropped turn in the vendor session.
