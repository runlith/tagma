---
id: 01a10510-45dd-7900-81b7-0e5f01013b02
title: "ACP: turn stream — updates, granularity, stop reasons, mid-turn input, cancel and resume after restart, read 2026-10-04"
ord: 2
tags: ["research"]
fields:
  {
    "source": {
      "name": "Agent Client Protocol: docs/protocol/v1/prompt-turn.mdx, v1/cancellation.mdx, v2/prompt-lifecycle.mdx, v2/migration.mdx, docs/rfds/v2/prompt.mdx; claude-agent-acp, codex-acp, gemini-cli sources; live probe of the Claude adapter",
      "ref": "agent-client-protocol 20361dd; claude-agent-acp a44c486 (0.85.1); codex-acp ca1d971 (2.1.1); gemini-cli 9a15c45. One prompt on the Claude adapter 0.85.1 and session/load in a new process, 2026-10-04: claude-acp-frames.jsonl, claude-acp-frames-load.jsonl in the research-acp thread scratch. Cancel and mid-turn input were not probed live"
    }
  }
---
Reading of 2026-10-04. The live probe is the Claude adapter 0.85.1 (one prompt); Gemini, Cursor, Devin, Kimi — only `initialize` and, on Gemini, a failed `session/new`; the rest is from docs and sources, marked as such.

## Turn updates (v1)

The agent sends `session/update`, the `update.sessionUpdate` field selects the variant (`docs/protocol/v1/prompt-turn.mdx`):

- `user_message_chunk`, `agent_message_chunk`, `agent_thought_chunk` — content chunks; `messageId` optional in v1 (one id — one message).
- `tool_call` (creation) and `tool_call_update`: `toolCallId`, `title`, `kind` (`read`, `edit`, `delete`, `move`, `search`, `execute`, `think`, `fetch`, `switch_mode`, `other`), `status` (`pending`, `in_progress`, `completed`, `failed`), `content[]` (`content`, `diff{path,oldText,newText}`, `terminal{terminalId}`), `locations[{path,line}]`, `rawInput`, `rawOutput`, `name`. Only `toolCallId` is required in an update.
- `plan` — the whole `entries{content,priority,status}` list anew; `available_commands_update`, `current_mode_update`, `config_option_update`, `session_info_update` (title, updatedAt), `usage_update{used,size,cost?}`.
- What actually arrives depends on the agent. Measured on the Claude adapter (frames in `claude-acp-frames.jsonl`): `available_commands_update` (commands = user skills), `usage_update`, `tool_call` with `status:"pending"` and empty `rawInput`, `tool_call_update` with filled `rawInput`, then `session/request_permission` (with `rawInput`), then `tool_call_update` `completed` with `rawOutput` and `content`; there was no `in_progress` status. Then `agent_message_chunk` (`"OK"`, one chunk with `messageId`), a final `usage_update` with `cost`, the prompt reply, and only after it `session_info_update` with the session title.

## Granularity

The protocol sets chunks, the agent picks the size. The Claude adapter enables `includePartialMessages` and turns `text_delta`/`thinking_delta` into `agent_message_chunk`/`agent_thought_chunk` (`acp-agent.ts` ~6384–6440, from sources); Gemini sends a chunk per `Content`/`Thought` stream event (`acpSession.ts:418-440`). Thought on Gemini arrives as `**subject**\ndescription`. In my probe the reply was two characters, so the probe itself proves nothing about chunk size.

The difference that breaks a naive client: on Gemini a tool needing confirmation is not declared in `tool_call` — a `toolCall` with `status:"pending"` arrives only inside `session/request_permission` (no `rawInput`, with `title`, `kind`, `locations`, `content` with diff for edits); a `tool_call` with `status:"in_progress"` is sent only for tools without confirmation (`acpSession.ts:727-829`). The client must create the call record from the permission request too.

## How the turn ends

- v1: reply to `session/prompt` with `stopReason`: `end_turn`, `max_tokens`, `max_turn_requests`, `refusal`, `cancelled`. A failure during the turn is an error reply to prompt.
- Unstable v1 `PromptResponse.usage`: the Claude adapter sends it (`inputTokens`, `outputTokens`, `cachedReadTokens`, `cachedWriteTokens`, `totalTokens`) plus `_meta.quota` with per-model breakdown; Gemini sends only `_meta.quota`. This is not a stable part of schema 1.24.1.
- v2 (draft): the `session/prompt` reply only confirms message insertion (`{messageId}`); the turn goes through `state_update` `running` / `requires_action` / `idle` with `stopReason`; a `stopReason:"error"` with an `error` object is added. The rest: tool call is only `tool_call_update` (upsert, `null` clears), `tool_call_content_chunk`, `plan_update` with `planId`, structural diffs (`changes` + a `git_patch`-format `patch`), `terminal_update`/`terminal_output_chunk` (display-only), `request_permission` has required `title` and `subject` (`tool_call` | `command`). `fs/*`, `terminal/*`, `session/set_mode` removed.

## Mid-turn input

The spec is silent. RFD `docs/rfds/v2/prompt.mdx`: "does not define queueing, steering, or inserting new prompts while the agent is busy". What agents do:

- Gemini (from sources): a new `session/prompt` in `Session.prompt` first calls `pendingPrompt.abort()` — the running turn is cut and returns `cancelled`, a new one starts.
- Claude adapter: `agentCapabilities._meta.claudeCode.promptQueueing: true` (prompts queue in a turn FIFO) and the `_session/steering{sessionId, prompt[], _meta.steering.idleBehavior?}` extension → `{outcome: "injected" | "startedNewTurn" | "promptRequired"}` for inserting into the running turn; support declared in the root `initialize._meta.steering.supported` (measured). Inside — SDK delivery with `now` priority (interrupts current generation) or `later` (if a permission request is open).
- Codex adapter: same `_session/steering`, `initialize._meta.steering.supported: true`, `SteeringQueue` serializes requests (from sources).
- Cursor, Devin, Kimi, OpenCode, Copilot: undetermined.

## Cancel

- `session/cancel{sessionId}` — a notification. The client marks unfinished tool calls `cancelled` and answers `cancelled` to all pending `session/request_permission`; the agent stops work, sends remaining updates, and must answer the prompt with `stopReason:"cancelled"`, not an error. The shared `$/cancel_request` (code `-32800`) is for arbitrary requests. In v2 the confirmation is `state_update idle` with `stopReason:"cancelled"`.
- Gemini: `cancelPendingPrompt` aborts the controller, the prompt returns `cancelled` (from sources). Cancel was not invoked in the live probe.

## Resume after process restart

The agent owns history. Measured on the Claude adapter: a new process, same `sessionId`, `session/load` → replay of `user_message_chunk`, `tool_call`, `tool_call_update` (`completed`), `agent_message_chunk` and the reply (`claude-acp-frames-load.jsonl`). The replay is collapsed: `request_permission` is not repeated, `in_progress`/partial `rawInput` are not restored. Gemini reads history from the project session file (`SessionSelector`, `acpSessionManager.ts:164-229`); without a declared `resume` on Gemini, resume is only via `session/load`.
