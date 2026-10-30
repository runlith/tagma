---
id: 01a108ea-e257-7c08-9e06-5979b05a4728
title: "Claude SDK P1: mid-turn words (now and later) are confirmed by uuid echo and go as a separate turn; interrupt() yields result in tens of ms"
ord: 7
tags: ["research"]
fields:
  {
    "source": {
      "name": "Live Claude Agent SDK probe: SDKUserMessage priority now/later, replay-user-messages, Query.interrupt() on a turn with an MCP tool and on generation",
      "ref": "@anthropic-ai/claude-agent-sdk 0.3.284, CLI 2.1.289, Bun 1.4.2, claude-haiku-4-5; 2026-10-04; ~/.tagma/scratch/01a10407-8719-764b-9fac-8b1d83b24de9/probes/claude/ (p7-steer.mjs, p7-steer-*.jsonl, p8-interrupt.mjs, p8-interrupt.jsonl)"
    }
  }
edges:
  - kind: relates
    to: 01a10838-8f2b-7e30-a2b0-7563adb9cd5b
---
Probe P1, 2026-10-04: SDK 0.3.284 under Bun 1.4.2, `claude` 2.1.289, Haiku. Frames and scripts — `~/.tagma/scratch/01a10407-8719-764b-9fac-8b1d83b24de9/probes/claude/` (`p7-steer.mjs`, `p7-steer-{later,now}.jsonl`, `p8-interrupt.mjs`, `p8-interrupt.jsonl`; timestamps are ms from query start).

Conditions: streaming input, `extraArgs: {'replay-user-messages': null}`, `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1`. A "live turn with a tool" is the model calling the `slow` MCP tool with `seconds=6` twice in a row; the mid-turn word sent 1.5 s after the first `tool_use` appeared.

## Mid-turn words: `later`

`SDKUserMessage {priority: 'later', uuid}` sent at 4.6 s (the tool runs until 9.1 s).

- At send time — only `system/command_lifecycle queued`; the uuid echo did **not** arrive.
- Turn 1 ran to the end with both tool calls: `result` #1 (`DONE-FIRST`, `user_message_uuids` = [first message uuid]) at 17.2 s.
- Right after — a new turn: `command_lifecycle started`, `system/init`, and only now the `user` echo with `isReplay: true` and the **word uuid** (17.7 s); the "DONE-FIRST LATER-ACK" reply accounted for the word; `result` #2 with `user_message_uuids` = [word uuid].

So `later` is an "after the turn" queue, a separate turn with its own `result`; acceptance is confirmed by the uuid echo when its processing starts and by `user_message_uuids` in `result`.

## Mid-turn words: `now`

`priority: 'now'` sent at 4.3 s (during `tool_use`).

- In 5 ms: `command_lifecycle queued` → synthetic `user` with `tool_result` "The tool call was interrupted before a result was received…" → `result` #1 (`subtype: success`, `result: ""`, `stop_reason: tool_use`, `terminal_reason: aborted_tools`, `user_message_uuids` = [first message]) → `command_lifecycle cancelled`.
- Then `started`, `system/init`, the word-uuid echo (+450 ms from sending), the `NOW-ACK` reply, `result` #2 (`end_turn`, `completed`).

So `now` cuts the running turn (the uncalled tool gets a synthetic result), and the word executes as a second turn; the first turn has its own `result`. The adapter code reading in [[84bfc57a]] ("now interrupts generation") is confirmed. Unverified: `now` during text generation (no tool), the `next` priority, tool-side behaviour on the MCP server after the cut (my server finished `slow` itself; cancel to the server unmeasured).

Confirmed for decisions 2 and 7: **exact acceptance** is given by the `isReplay` echo with the send uuid; but it arrives not at send time but when processing starts (for `later` — after the current turn ends). For `now` and `later` the outcome is the same: each word gets a separate turn and a separate `result` with its uuid.

## `Query.interrupt()`

One query, three turns in a row (`p8-interrupt.mjs`):

| Turn | Call moment | `interrupt()` returned | `result` after | `subtype` / `terminal_reason` |
|---|---|---|---|---|
| `slow` call (8 s) | 1.5 s after `tool_use` | `{still_queued: []}` in 8 ms | 25 ms | `error_during_execution`, `is_error: true`, `aborted_tools`, `stop_reason: tool_use` |
| Generation (numbers 1–400) | 0.8 s after first `text_delta` | `{still_queued: []}` in 4 ms | 17 ms | `error_during_execution`, `is_error: true`, `aborted_streaming`, `stop_reason: null` |
| "reply OK" | — | — | — | `success`, `OK` |

- On a tool cut arrive synthetic `tool_result` "The user doesn't want to proceed with this tool use. The tool use was rejected…" and a `user` text "[Request interrupted by user for tool use]", then `result`.
- The process is alive, the session intact: the third turn in the same query passed.
- `result.usage` on `aborted_streaming` is zeros (the model managed to emit tokens, but they did not enter `usage`); on `aborted_tools` usage is non-zero (1158/92). `total_cost_usd` on cuts did not grow after the first interrupted turn (0.002604 → 0.002604), i.e. **usage of an interrupted stream is undercounted**.
- `permission_denials` empty, the `errors` field holds the diagnostic string "[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=…".

Profile conclusion: `interrupt()` is fast (tens of ms to `result`) and leaves the session alive, so the Claude runner's stop grace can be short (seconds, not the Zed adapter's 30 s, whose benchmark is unmeasured). For the ACP `cancelled` stopReason, `error_during_execution` with `terminal_reason ∈ {aborted_tools, aborted_streaming}` must map to it. Unverified: `interrupt()` with a pending `canUseTool` (the runner has none, `bypassPermissions`), on a hung MCP tool, after a `still_queued` with a non-empty list.
