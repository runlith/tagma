---
id: 01a15f18-7121-7151-b58b-66db980edf66
title: "Claude Code 2.1.306: interrupt with cancelQueued removes words from the queue, without it the word starts a new turn; interrupt on command_lifecycle started cuts the turn before the model request — probe 2026-10-21"
ord: 6
tags: ["research"]
fields:
  {
    "source": {
      "name": "Claude Code CLI via Claude Agent SDK: interrupt, cancel_queued, cancelAsyncMessage, command_lifecycle, session_state_changed",
      "ref": "claude 2.1.306, @anthropic-ai/claude-agent-sdk 0.3.292, Bun 1.4.3, haiku model; 2026-10-21; scratch 01a15f02…/probe.ts, live.ts"
    }
  }
edges:
  - kind: relates
    to: 01a15eeb-6b48-7ca8-9c93-24d5a5ed6cb2
---
Live probes of 2026-10-21: installed `claude` 2.1.306 (`pathToClaudeCodeExecutable` = `~/.local/bin/claude`), Agent SDK 0.3.292 under Bun 1.4.3, `haiku` model. One run per variant, 7 runs total. Options same as the runner's: streaming input, `includePartialMessages`, `replay-user-messages`, `bypassPermissions`, `settingSources: []`. Two differences: `tools: ['Bash']` (the `sleep 6` scenario) and `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1`. A mid-turn word is `priority: 'next'` with its own uuid, sent right after the assistant message with `tool_use`; `interrupt()` — 700 ms after sending. Scripts `probe.ts` and `live.ts` lie in the `01a15f02-5d74-78a2-9337-50d0730ce132` thread scratch and leave with the thread.

## `interrupt({ cancelQueued: true })`

In SDK 0.3.292 d.ts, `Query.interrupt()` is declared with no arguments. At runtime (`sdk.mjs`) it takes `{ cancelQueued }` and sends the control `interrupt` request with `cancel_queued: true`. The field contract is recorded in d.ts on `SDKControlInterruptRequest.cancel_queued` and `SDKControlInterruptResponse.cancelled`. 2.1.306 `init` declares `interrupt_cancel_queued_v1`; the 2.1.292 SDK bundle does too.

- **With `cancelQueued`.** Receipt `{"still_queued":[],"cancelled":[<word uuid>]}`. Right after come the word's `command_lifecycle` `queued` and `cancelled`. The interrupted turn's result is `error_during_execution` / `aborted_tools`, `user_message_uuids` = [prompt uuid]. Then the prompt's `command_lifecycle` `cancelled` and `session_state_changed: idle`. There is no word echo, no turn with it.
- **Without it.** Receipt `{"still_queued":[<word uuid>]}`. The interrupted turn's result carries `queued_turn_count: 0`, though the word stands in the queue. After 1 ms the word's `command_lifecycle` yields `started`, and Claude Code starts a new turn: `init`, then the model request. No `idle` arrives between the two turns, only after the second.
- **Without it, but with `cancelAsyncMessage`** on the `still_queued` uuid: reply `true`, then `command_lifecycle` `cancelled`, no turn with the word.

## When to interrupt a turn started by a word

- **`interrupt()` on the word echo.** The echo arrived 1.2 s after `started`. The same request's `message_start` arrived 8 ms after the echo and 0 ms after the interrupt reply. So by the echo the model request had already gone out and started answering. Result — `aborted_streaming`.
- **`interrupt()` on the word's `command_lifecycle` `started`.** Receipt `{"still_queued":[]}` in 12 ms, then `init`, the word echo, "[Request interrupted by user]" and `aborted_streaming` within 2 ms. No `message_start`. The echo arrives even for an interrupted turn, and the word stands in its history.

## Interrupt before the CLI reads the prompt

The prompt was handed to the input stream, and `interrupt({ cancelQueued: true })` called right after it. Receipt `{"still_queued":[],"cancelled":[]}` arrived before the prompt's `command_lifecycle` `queued`: the control request overtook the message. The prompt then ran as a regular turn to the end (`success` / `completed`). So a word the CLI has not read yet survives any interrupt.

## Runner end-to-end run

`live.ts` — `claudeAgent` with the real SDK, a scripted door (the `wait` tool sleeps 6 s) and the same `claude`.

- **Steer during a call, then `session/cancel`.** Receipt `dropped` = [word uuid]. The prompt answered `cancelled` 9 ms after cancel, the steer — a -32800 refusal. No second turn.
- **`session/cancel` 1 ms after `session/prompt`.** Three `interrupt()`s: on cancel, on the prompt's `started` and on its echo. The prompt answered `cancelled` in 13 ms. No `usage_update`, i.e. no model request finished.
- **Next prompt** in the same session answered `end_turn`.

## Undetermined

- Behaviour of a CLI without `interrupt_cancel_queued_v1` and without `msg_lifecycle_v1` not probed live: the installed `claude` declares both. The runner's fallback road is verified only by a test on a fake `Channel`.
- Merging several surviving words into one message and withdrawing the merged packet's representative (per d.ts it removes the whole packet, and `cancelAsyncMessage` replies `false`) were not reproduced.
- One run per variant: timings are a sample, not a distribution.
