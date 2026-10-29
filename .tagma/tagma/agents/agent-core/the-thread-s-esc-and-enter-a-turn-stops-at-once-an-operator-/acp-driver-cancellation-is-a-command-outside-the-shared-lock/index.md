---
id: 01a15eeb-6b48-7ca8-9c93-24d62b8fd967
title: "ACP driver: cancellation is a command outside the shared lock, the cancel frame overtakes the stdin queue"
ord: 3
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/external-harnesses/protocol
---
Canceling a turn on ACP is a command with its own lane. It does not queue behind the thread's work, and the cancellation frame leaves for the agent's stdin ahead of everything not yet written.

## What stands

- **Cancellation awaits the thread's shared lock.** The `ProtocolRuns.interrupt` → `inputs.cancelled` → `reactor.change` chain runs under `links.locked` — a one-permit semaphore per thread (`links.ts:22`, `reactor.ts:83-96`). The same lock is taken by:
  - reading every stdout chunk;
  - frame receipts;
  - word delivery together with guidance assembly, attachment reads, and base64 images (`prompts.ts`, `pictures.ts`);
  - the tail timer and `halt`.
- **Cancellation is a state change.** First `cancelling: true` in the line (the first durable write), then `react` → `reconciled` → `steps.intend Cancel` (the second), and only then the frame in the writer queue (`reactor.ts:120-127`).
- **The writer is FIFO** (`writing.ts:36-70`). A new epoch removes only the prompt and answers to the agent (`writing.ts:13-14`). Steer, withdraw, compact, and configure are appended whole before the cancellation. In the 2026-10-21 incident a steer carried a 222 KB PNG — about 19 chunks of 16 KB each, each with a host receipt. Under backpressure — up to 30 s (`link.ts`).
- **Silent no-ops:**
  - no process connection and a `running` turn → `recall` exits silently (`runs.ts:263-265`);
  - `attendance.current` empty → success (`inputs.ts:72-73`);
  - no `sessionKey` or `prompting` false → the flag is removed without a frame (`reactor.ts:124-126`).

  Such a cancellation only arrives as a `Recovered` step on the next connection; the takeover tick is 15 s.
- **Five owners of the stop intent:** the core's `stopRequest`, the line's `turns[].stoppedBy` and `cancelling`, the client machine's `request.cancelled`, the runner's `running.cancelled`.
- **An ACP turn ends only on `TurnEnded` from the agent.** While the agent works, Tagma's turn reads "going": 36 s in the incident.
- **Pass-through layers:** `ProtocolInputs.cancel`/`cancelled`, `ProtocolDriver.cancel`/`stop`/`current`, `reactor.pump`/`held`. `ProtocolRuns` takes 20 constructor parameters.

## What will stand

- **Cancellation gets its own lane.** It takes no thread lock and writes a single durable record — the core's stop intent; the line flags leave as intent owners. The `session/cancel` frame goes to the head of the writer queue.
- **A new epoch cuts off any unrecorded frame** and any unfinished transfer of a frame. A frame cut off mid-transfer is marked undefined — by the same rules as the prompt now ([[6bfa7543]]).
- **Heavy preparation runs before the lock.** Guidance, attachment reads, and base64 images go before the lock. Only the state transition and the write stay under it.
- **The `interrupted` receipt** means the cancellation frame is admitted into the agent's stdin (`Admitted`).
  - On it the core ends the turn `aborted`, and the driver seals the tail at that point.
  - The agent's frames about the interrupted turn after it are not written into the turn journal. Their cost settles on the turn once ([[c2ddbc0a]]).
- **The next prompt awaits the agent's answer to the cancellation** — `TurnEnded` or a prompt answer. The thread snapshot shows this wait as the cause (`waiting`), not as a "going turn".
- **Without a process connection** the driver attaches it at once, not on the takeover tick, and the cancellation leaves as the new connection's first frame. No process means an orphaned turn, answer `no-turn`.
- **Pass-throughs merge into their owners** where cancellation and words touch them. `ProtocolRuns` dependencies group by subject.

## Acceptance

A stest with a scripted ACP agent, cancellation under four conditions:
- with the lock held (long guidance assembly);
- with a steer carrying an image queued;
- under stdin backpressure;
- with no process connection.

In each case the cancellation frame is recorded first of the unrecorded frames, the turn ends `aborted` on the receipt, and the agent's late output about the interrupted turn does not appear in the journal.
