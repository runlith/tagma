---
id: 01a113ff-0d62-74ec-ae7c-e91316a4c8ac
title: "The ACP driver: the client machine issues the request id, the extension's declaration parses its answer, one wait and one row-change road, parts assembled by owners with no closures"
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/external-harnesses/protocol
  - kind: file
    ref: packages/acp/src/client.ts
---
## What the operator gets

Behavior of `acp` threads never changes. What changes is the price of the next driver change: a new `_tagma/*` extension is one declaration, not edits in five places. Every extension road is verified with no Claude and no network.

## Now

- **The request id is guessed.** Steer, compact, rewind and aside compute their request id as `${row.client.incarnation}:${row.client.counter + 1}` before `intend`, hoping the client machine issues exactly that.
- **Every feature finds its own answer.** It is found in the step's events by:
  - `revised` (fork and rewind);
  - the answer branch in `compactStep`;
  - `steeringOf` and `steerFate` inside `ProtocolSteps.saved`;
  - `ProtocolAsides.answered`, called by both `ProtocolTurning.follow` and `ProtocolTurning.refused`.
- **Five waiting mechanisms, plus polling:**
  - `ProtocolHistory.waiters` with `waitFor`;
  - `ProtocolCompactions.waiters` with `wait`;
  - `Openings.waiting`;
  - `ProtocolAsides.waiting`;
  - `ProtocolSteps.introductions`.

  Besides them `ProtocolProcess.ending` polls every 50 ms whether the turn ended and the session closed.
- **Two row-change branches.** `ProtocolDriver.answer`, `ProtocolDriver.cancelled`, `ProtocolHistory.change` and `ProtocolProcess.endingsOut` each decide for themselves: with a live link — `turning.locked` + `steps.persist`, without one — `store.change` with `rows.read`/`rows.write`.
- **Assembly with cycles.** `ProtocolDriver`'s constructor takes 19 parameters, `ProtocolProcess` 18, `ProtocolTurning` 15. Cycles between parts are broken with closures: `(threadId) => this.process.links.get(threadId)`, `(link, work) => this.turning.locked(link, work)`, `(link) => this.settled(link)`. Through `wake`/`halt`, history and compaction call `ProtocolDriver.start` and `stop` upward.

## Goal

**1. The machine issues the id.** The client machine's `act` (`packages/acp`) returns the issued request's id in the step, and the caller takes it from there. Nothing guesses the id anywhere.

**2. An extension is a declaration.** Every `_tagma/*` method is declared once:

- the answer schema;
- a pure answer handler over the row: row and answer-or-refusal in, new row, reaction events, journal records and inbox envelope fates out.

`ProtocolSteps.saved` hands every `ExtensionAnswered` and `RequestFailed` of an extension request to its declaration in one place and applies envelope fates in the same machine write as now. Steer, compact with its `_tagma/compacted` notice, fork, rewind and aside become declarations; `revised`, the answer branches in `compactStep` and `saved`, and `asides.answered` are deleted.

Notices are declarations too: `_tagma/compacted` belongs to compact, and only it writes every boundary of its compaction — `completed`, `failed`, `aborted`; `_tagma/said` has its own declaration. The projection never parses the method name. Declaration tables are typed as a total map over the `extensions.ts` method sets, so a missing declaration fails typecheck. An answer to an undeclared method is noise, not a prompt cause.

Whatever is durable stays durable. Steer, compact, fork and rewind fates are recorded in the row and survive restart. An aside answer lives only in memory: process death is a refusal. The aside declaration, like the rest, is pure: it returns the outcome, and `saved` hands it to the waiter only after the step is written.

**3. One wait.** The live-link owner raises the thread signal after every written step and when a link drops. `until(threadId, predicate, deadline)` answers when the predicate holds and refuses when the session ended or the row carries a failure — just like `history.waitFor` now. All five waiter maps and the stop poll move onto it.

**4. One row-change road.** The reactor owns `change(threadId, plan)`: with a live link — under its lock via `steps.persist`, then `react` and `flush` (which is why it stands at the reactor, not at links); without a link — `store.change` with the row. The link is rechecked under the lock: if it dropped while the change waited, the change goes over the saved row. Every current double branch goes through it.

**5. Parts by owners, bottom up.** Every part takes dependencies positionally ([[c2f04d22]]). None takes a closure onto a neighbor or calls upward.

| Part | Owns | Currently there |
| --- | --- | --- |
| Links | live links, link lock, wait signal | `ProtocolProcess.links`, waiter maps |
| `ProtocolSteps` | the durable step and extension-answer dispatch | same plus steer parsing |
| Owners inside the lock | vendor permission requests, prompt and steer composition, session opening, extension declarations | `ProtocolAsks`, `ProtocolTurning` |
| Reactor | `locked`, `react`, `flush`, `change` | `ProtocolTurning`, double branches |
| Launcher, Process, Endings | execution start; stdout, heartbeat and writer reading; session end and report | `ProtocolProcess` |
| Attendance | `start`, `attend`, `stop`, `retire`, `recover`, `onWorking` | `ProtocolDriver` |
| History, Compactions, Asides | operations awaiting a result: fork, rewind, restore; compaction; aside | same-named classes calling the facade |
| `ProtocolDriver` | the `HarnessSessions` and `ProtocolSessions` facade, assembly and delegation only | all orchestration |

Every operation needing a live process calls Attendance, which stands below it — not the facade above. Rewind, for example, is `start` → `until(ready)` → turn cancel → `until(idle)` → extension request → `until(answer)`.

Durable-step behavior never changes: [[e47bd3fc|step write]] and [[6bfa7543|frames queue outside the transition lock]] stay true.

## Verification

The performer proves:

- **all current protocol system tests** (`protocolRoad`, `protocolRuns`, `protocolTransport`, `protocolHandover`, `protocolBarrier`, `protocolThreshold`) pass with assertions unchanged;
- the **fake ACP agent** (`testing/acpAgent.ts`) declares `_tagma/steer`, `_tagma/compact`, `_tagma/fork`, `_tagma/rewind` and `_tagma/aside` and answers per script. Without Claude these are verified:
  - steer fates: confirmed, returned, unconfirmed;
  - compact: success, failure and cancel with spend;
  - session change after fork and rewind;
  - aside: answer, refusal and session close;
  - every durable request with the server restarted before its answer;
  - a stop that ends on signal within the grace;
- **code search:** `counter + 1` occurs only in the client machine; `protocol/` holds no `Deferred` thread-state wait outside the links owner, and `STOP_BEAT_MS` is deleted. The writer cancel signal and the activity fiber handshake are not thread-state waits and stay with their owners.

Notes rewritten by the same change: [[e47bd3fc|step write]], [[92391518|Claude compaction]], [[f3949b43|aside via session]].
