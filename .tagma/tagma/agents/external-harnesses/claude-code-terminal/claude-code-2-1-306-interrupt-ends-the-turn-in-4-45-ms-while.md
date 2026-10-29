---
id: 01a15fb9-365a-7198-a5fc-f3c0b54e302c
title: "Claude Code 2.1.306: interrupt ends the turn in 4–45 ms while thinking, in text, in an MCP call, WebFetch and /compact; a /compact the CLI has not read survives interrupt; a merged message after interrupt — probe 2026-10-21"
ord: 8
tags: ["research"]
fields:
  {
    "source": {
      "name": "Claude Code CLI via Claude Agent SDK: interrupt with cancelQueued in turn states, /compact, PreToolUse WebFetch hook, merged message",
      "ref": "claude 2.1.306, @anthropic-ai/claude-agent-sdk 0.3.292, Bun 1.4.3, haiku and sonnet models; 2026-10-21; scratch 01a15fa9…/probe.ts, logs/"
    }
  }
edges:
  - kind: relates
    to: 01a15eeb-6b48-7ca8-9c93-24db7deebf81
---
Live probes of 2026-10-21: installed `claude` 2.1.306 via Agent SDK 0.3.292 under Bun 1.4.3. Model `haiku`, for thinking — `sonnet` with `thinking: { type: 'adaptive', display: 'summarized' }` and `effort: 'high'`. Query options as the runner's (`lifecycle.ts`): own `systemPrompt` with `snapshot: false`, `tools: []` (for `WebFetch` — `['WebSearch', 'WebFetch']`), `strictMcpConfig`, the in-process `tagma` MCP server from `mcpToolServer` (the `wait` tool sleeps N seconds), `settingSources: []`, `settings` with auto-compaction off, `CLAUDE_CODE_AUTO_COMPACT_WINDOW`/`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` environment, `PreCompact`/`PostCompact` hooks, `bypassPermissions`, `includePartialMessages`, `replay-user-messages`. The only difference: `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1` for `session_state_changed`. The `PreToolUse` hook for `WebFetch` repeats `fetching.ts` before the fix: waits with no reply and does not listen to the signal.

Scenario: prompt, then in the needed state a `priority: 'next'` word with its own uuid and 300 ms later `interrupt({ cancelQueued: true })`, as the runner calls; then a "Reply OK" follow-up checks the session is alive. Time is from the `interrupt` call to `result`, on the probe process clock. Script `probe.ts` and logs `logs/*.log` lie in the `01a15fa9-e310-793a-ad96-beecfa95d169` thread scratch and leave with the thread.

## Measured

| State | n | Receipt | To `result`, ms | `result` | Word |
|---|---|---|---|---|---|
| Thinking: 800 ms after `message_start`, retelling not yet arrived | 4 | 2–8 ms | 6, 7, 16, 24 | `error_during_execution` / `aborted_streaming` | removed (`cancelled` = [uuid]), not executed |
| Text: 500 ms after first `text_delta` | 3 | 2–7 ms | 6, 12, 22 | `aborted_streaming` | removed, not executed |
| Tagma MCP tool call | 3 | 5–32 ms | 8, 27, 45 | `aborted_tools` | removed, not executed |
| `WebFetch` with open `PreToolUse` hook | 3 | 4–22 ms | 15, 28, 32 | `aborted_tools` | removed, not executed |
| `/compact` during compression (`status: compacting`) | 5 | 2–6 ms | 7, 8, 12, 21, 26 | `success`, empty `terminal_reason`, "Compaction canceled." text | removed, not executed |
| `/compact` right after sending, before CLI read | 4 | 2–6 ms, `cancelled: []` | 12 296, 15 937, 16 653, 18 838 | `success`, compression ran to the end | no word |
| Same and second `interrupt` on `command_lifecycle` `started` of the `/compact` command | 3 | 1–5 ms and 8–10 ms | 11, 21, 29 | "Compaction canceled." | no word |
| Word already started its turn (`started`, `status: requesting`) | 2 | 2–4 ms, `cancelled: []` | 4, 10 | `aborted_streaming`, `user_message_uuids` = [word] | echo arrived, word stayed in session history |

State details:
- **Thinking.** With `display: 'summarized'` Claude Code sends no `thinking_delta` along the way: the retelling and `system/thinking_tokens` arrive in a batch at the end of thinking. Interruption before the retelling yields "[Request interrupted by user]" and `message_stop` with no `thinking` block.
- **Tagma MCP call.** The MCP request cancel signal fires in 2–25 ms, before `result`; synthetic `tool_result` "The user doesn't want to proceed…" and "[Request interrupted by user for tool use]".
- **`WebFetch`.** Claude Code cuts the hook signal in 4–22 ms and ends the turn without waiting for the hook reply. The call gets a synthetic refusal, like an MCP call.
- **`/compact` during compression.** `status` with `compact_result: failed` and `compact_error: 'API Error: Request was aborted.'`, then the "Compaction canceled." reply and the `/compact` echo, the command's `command_lifecycle` — `cancelled`. No `compact_boundary`.
- **`/compact` right after sending.** The receipt arrives before the CLI reads `/compact`, and is empty. Then the command goes `queued` → `started` → `compacting` and reaches `compact_boundary` and retelling in 12–19 s. Interruption on `started` of this command cuts it the same as during compression.
- **Follow-up** after every interruption answered `success` / `completed` in all 33 runs.

## Merged message after interrupt

Two `priority: 'next'` words during a call, then `interrupt()` without `cancelQueued` (the CLI road, which did not remove the words). Receipt — `still_queued` = [word 1, word 2], the interrupted turn's `result` — in 6–19 ms (n = 3).

- Right after `result` both words get `command_lifecycle` `started` as one turn. Word 1's echo carries its uuid and only its text. The second echo is under word 2's uuid with both texts joined by a newline; it arrived with `message_start`, 0.8–1.1 s after the first. This turn's `result` is `success` with `user_message_uuids` = [word 1, word 2].
- In the transcript (`getSessionMessages`) one record under word 2's uuid with the merged text; there is no separate word 1 record.
- `interrupt({ cancelQueued: true })` on word 1's `started` (n = 3): receipt `cancelled: []` — the words are already in the turn packet. The packet still starts: word 2's `started`, `status: requesting`, merged echo, "[Request interrupted by user]", `aborted_streaming` 11–27 ms after the second interrupt, no `message_start`. Both words get `command_lifecycle` `cancelled`, but the merged record stays in session history.

## Conclusion

- Claude Code interruption in every measured turn state answers with a receipt in single–tens of ms and ends the turn with `result` in 4–45 ms; process and session alive. Tagma has no need to wait on the vendor for the turn end — the same shows in [[b05a4728]] on 2.1.289.
- `cancelQueued` removes a queued word in every turn state. A word whose turn already started stays in session history even after interrupt: the next model request reads it.
- A `/compact` the CLI has not read yet survives interrupt just like a prompt in [[980edf66]]. Before this work the runner called interrupt once and answered the compaction with a -32800 refusal, though Claude Code was compressing the session: the Tagma journal and the vendor session diverged. Fixed: a cancelled compaction is interrupted again on `command_lifecycle` `started` of its command, and on a CLI without these frames — on `status: compacting` (a conclusion, not probed live).
- The `WebFetch` hook abandoned by Claude Code held the `session/request_permission` request to the client open. Now the hook yields its work's signal, and the abandoned request is cut along with it.

## Undetermined

- Interruption during the thinking stream with default `display` and on other models not measured.
- A `PreToolUse` hook replying after interrupt not verified: Claude Code no longer waits for it, and what it does with a late reply is unmeasured.
- 2–5 runs per state — a sample, not a distribution. Timings include the probe process event loop.
