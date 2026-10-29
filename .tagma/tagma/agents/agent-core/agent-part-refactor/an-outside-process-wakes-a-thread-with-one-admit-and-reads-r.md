---
id: 01a118eb-3e7e-7085-8f2e-2cce9f3bb3f9
title: An outside process wakes a thread with one admit and reads RunStatus, batched too
ord: 4
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/agent/src/thread/run/ThreadIntrospection.ts
---
Goal: a process outside the thread — a dealer, an observer, an outside script — wakes a thread with one act and reads run status with one read, batched over a hundred threads too. It needs no road choice, and it does not re-derive "is the agent thinking now".

## Now

- Tagma has `start_turn`, `queue_turn`, `steer_turn`, `answer_question`, `stop_run` and `read_thread` operations. Feed ingress admits only an `operator`-kind caller (`threads/contract/wire/feeds.ts:27-35`). `continue_thread` is available only over the socket (`threads/contract/wire/operations/catalog.ts:219-222`).
- `ThreadSignals` in the package returns typed receipts with idempotent redelivery.
- `ThreadIntrospection` drops stage, waiting and open-question ids (`ThreadIntrospection.ts:394-420`). Staleness by durable-movement age is derived in `Commands.ts:495-519`.

## What is built

- **`RunStatus`** — a projection of the `thread/read` read model and the single answer to "is the run alive and what does it wait for":
  `{ threadId, runId | null, life: idle | working | awaiting | stalled, stage, openQuestions: QuestionId[], since, ownership?: held | stale-evidence | recovering, ending? }`.
  - `stalled` refers to expected execution progress, not to waiting for a human answer. A run in `awaiting` does not age into `stalled`; `stalledSince` is likewise suppressed while a question waits (`Commands.ts:191-199,519`).
  - `ownership` is absent at `runId: null`. For an active run it distinguishes a confirmed owner, stale heartbeat evidence and in-flight recovery. Ownership loss is claimed only by the owner's claim answer ([[7e9130bd]]).
  - The `RunStatus` owner itself publishes the transition to `stalled` when the deadline passes with no fresh event, and removes it on progress. That driver acts only for active work.

  Snapshot and state events carry `RunStatus` ([[c3436715]]).
- **`RunReceipt`** — a wake-act answer: `{ status: delivered | queued | woken | stored, runId | null, acted }`.
- **`admit`.** The core facade's public act `admit(threadId, item, caller, key) → RunReceipt`, idempotent on `key`.
  - A repeat with the same content returns the earlier receipt; with different content — a typed conflict.
  - Until [[a34152ed]] is built it picks among today's roads in one facade place. After — it becomes the `RunScheduler` entry, and the contract does not change.
  - Control acts (stop, question answer) stay their own operations: `admit` does not mask them.
- **Input receipts.** Every turn command — send, queue, steer, from the operator or from outside — goes through `admit` with a client-generated key.
  - The producer records the receipt under that key: accepted as `said`, `queued` or `steered`, or refused with a code.
  - Repeating the same command with the same key after a lost answer is idempotent and answers with the recorded receipt. So a client that lost the answer after sending learns the outcome authoritatively, not from a snapshot row's absence.
  - Snapshot and `RunStatus` carry receipts of not-yet-executed inputs (queued or awaiting steer).
  - A receipt answers the existing keyed contract (operation, caller and key identity, digest, outcome; `thread/keyed.ts:16-36`), not a second ledger.
- **`statuses`** reads explicitly named threads in the caller and project scope, page by page: `limit`, `total`, cursor ([[68659e3b]]).
  - Every row carries `threadId`.
  - A missing or unreachable thread gives a typed outcome in its own row.
  - Cost grows with the picked page.
- **The outside caller at Tagma doors** ([[1a45453a]]): a generalized caller kind that is neither operator nor thread. `start_turn`, `queue_turn`, `continue`, `read_thread` and `statuses` admit it with `caller` instead of the substituted `senderThreadId`.
  - There is no plugin-specific kind.
  - Authentication is outside the rework (root's open question 2).
- **Reading ends** (`endings`) is built by [[7e9130bd]]. Here it is only exposed outward with the same caller kind.

## Acceptance criteria

- A read-model test:
  - a run waiting for an answer reads as `awaiting` with the question id and does not age into `stalled`;
  - after the answer it is `working`;
  - `ownership` changes separately from `life` and is absent on an idle thread.
- A driver test: a subscriber gets the transition to `stalled` over time with no fresh event recorded, and its removal on progress.
- An operation test: an outside caller wakes a thread through `admit`.
  - A repeat with the same `key` returns the same receipt with `acted: false` and opens no second run.
  - The same `key` with a different item gives a typed conflict.
- A receipt test: send, queue and steer with a client key, repeated after a lost answer, return the same receipt and do not duplicate the input. A refusal answers with its own code. A standing queued input is visible in the snapshot with its receipt.
- A `statuses` test: a page of 100 threads answers with one page read — rows and bytes proportional to the page, not the project thread count. `total` and cursor continue the walk. A foreign thread gives a typed outcome in its own row.
- Tagma and chat do not derive liveness a second time ([[51c66cb6]]). The chat side is checked by its spec.
