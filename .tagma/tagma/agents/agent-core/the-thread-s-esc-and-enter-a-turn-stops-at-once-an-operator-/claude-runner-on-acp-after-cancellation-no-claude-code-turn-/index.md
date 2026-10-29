---
id: 01a15eeb-6b48-7ca8-9c93-24d5a5ed6cb2
title: "Claude runner on ACP: after cancellation no Claude Code turn continues"
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/external-harnesses/runner/claude-code
---
After a cancellation the runner lets no Claude Code turn continue. This is the cause of the 2026-10-21 incident.

## What stands

- **`Turn.cancel` (`turn.ts:160-186`).**
  - With `inFlight === 0` the cancellation only releases `halted` and never calls `interrupt()` (`:165-168`).
  - A word whose recall is unconfirmed (not in `still_queued`, `cancelAsyncMessage` answered false or failed) becomes a survivor. The survivor holds the turn until its echo (`:171-176`, `:266-268`).
  - A repeated cancellation exits at once (`:163`).
- **A turn opened by an echo is never interrupted.** A turn opened by a survivor's echo or a merged message (`took`, `:213-234`) is interrupted by nobody. Its normal `result` overwrites the `cancelled` outcome (`:269-282`), and the prompt answers `end_turn` (`translate.ts:319-337`).
- **Cancellation awaits.** It awaits a repeated `tools/list` up to 5 s (`bridge.ts`) and query reopening (`lifecycle.reopen`, ~0.6 s in probe [[d63511e6]]).
- **A word during reopening is lost.** It receives a "session is reopening" refusal (`lifecycle.ts:178-181`, `turn.ts:127`), the driver marks it unconfirmed, and the model never sees it.
- **`query.interrupt()` without a deadline** and with no outcome for a failure (`sdk.ts:102-106`).

Incident log:
1. Esc at 14:11:01.764.
2. Model request cut ~70 ms later; reasoning #1372 cut mid-sentence.
3. Word echo at ~14:11:03.8, then a new vendor turn: 35 s of thinking and an answer.
4. Repeated Escs discarded by `turn.ts:163`.
5. The turn answered `end_turn`.

## What will stand

- **Cancellation clears the queue.** Cancellation calls `interrupt({ cancelQueued: true })`. The SDK types lack the argument, so only `sdk.ts` calls it, through `Channel`. Claude Code removes all our words: queued ones and ones already taken into the next turn's batch. It lists them in `cancelled`, and none of them executes ([[980edf66|probe on 2.1.306]]). A CLI that does not know the argument answers only `still_queued`. Words from that list are then removed via `cancelAsyncMessage`.
- **Cancellation is turn state, not a one-off act.** While a turn is cancelled, every new Claude Code turn is interrupted on the fact of its start. That is the turn of a surviving word, of a merged message, or of a prompt the CLI already read from stdin after interrupt. The start fact is the `command_lifecycle` `started`: it arrives before the model request. A CLI without those frames gives only the echo, and by the echo the request has already left. A repeated cancellation calls `interrupt()` again.
- **Word fates under cancellation.**
  - A word Claude Code removed receives refusal -32800, and the core queues it for the next turn instead of marking it `Unconfirmed`.
  - A surviving word Claude Code is sure to execute. That is a word the CLI has not yet read from stdin, or a word on an old CLI that `cancelAsyncMessage` did not remove. It does not extend the turn: its turn is interrupted at the start. But it delays the prompt answer until its echo or until `command_lifecycle` `cancelled` without a start. Otherwise a Claude Code turn would have started after the answer: its `result` would end the next prompt, and the word would stand twice in the transcript.
  - A word whose echo arrived before the turn end is read by that turn.
  - A word with no echo by the turn end (cancellation before the first `send`, session death) receives -32800.
- **The `cancelled` outcome is not overwritten** by a later `result`. A prompt after cancellation answers `cancelled`.
- **Awaiting `tools/list` and reopening are interruptible.** The turn answers `cancelled` without giving Claude Code anything.
- **A runner queue for early words.** A word during reopening and before the first `send` stands in the runner queue and leaves right after `send` — not as a refusal and not as `promptRequired`.
- **A failing `interrupt()`** is a fact: the runner closes the query (`close()`), the session restarts, the turn is ended, and the prompt answers `cancelled`. No timers.
- **Claude Code specifics stay inside the runner.** `promptRequired`, survivors, and echo text merging do not enter the transport contract: the driver and the core see a word as read, returned, or undefined.

## Acceptance

`contract.test.ts` on fake `ClaudeSdk` and `Channel`:
- **The 2026-10-21 incident:** steer handed over, Esc before its echo, `cancelAsyncMessage` → false, then the echo and a new turn. The prompt answers `cancelled`, and `interrupt()` is called on the new turn before the first model request.
- **Cancellation in early states:** at `inFlight === 0`, during `tools/list`, during reopening.
- **A repeated cancellation** calls `interrupt()`.
- **Fallback road:** a CLI without `cancelQueued` and without `command_lifecycle`, `cancelAsyncMessage` did not remove the word. The surviving word holds the answer until its echo, the turn opened by the echo is interrupted, the prompt answers `cancelled`.
- **A word during reopening** reaches Claude Code exactly once.
