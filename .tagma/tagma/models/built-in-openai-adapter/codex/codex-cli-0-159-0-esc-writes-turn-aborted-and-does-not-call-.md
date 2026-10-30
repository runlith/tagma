---
id: 01a11d92-f13e-70e0-a79e-313114005f86
title: "Codex CLI 0.159.0: Esc writes turn_aborted and does not call Stop, words join the running turn, Stop does not end a turn with a queued word, 200 s Bash — probe 2026-10-08"
ord: 1
tags: ["research"]
fields:
  {
    "source": {
      "name": "Live probes T1–T5 in PTY: Esc on Bash, mid-turn words, slowed Stop hook, 200 s Bash, rollout on disk",
      "ref": "Codex CLI 0.159.0, gpt-5.6-luna low; 2026-10-08; scratch 01a11d5b…/probe (codex.hooks.jsonl)"
    }
  }
edges:
  - kind: discovered-from
    to: 01a11ca5-7ddf-7f42-a891-bd659b043055
---
Codex CLI 0.159.0, model `gpt-5.6-luna` with `model_reasoning_effort=low`, `--dangerously-bypass-approvals-and-sandbox`, 2026-10-08, one host (macOS). Probe `CODEX_HOME` is the Orca account directory (`~/Library/Application Support/orca/codex-accounts/<id>/home`), not `~/.codex`. Hooks are the project `.codex/hooks.json` with a logger (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop, SessionEnd, PermissionRequest, PreCompact); until each hook is confirmed in the "Hooks need review" panel, it does not run. The transcript (rollout) was read from disk. Tool: `node -e "setTimeout(…)"`. Measurements [[a621fbb3]], T1–T5.

## T1. Turn end on interrupt

Observations (Esc mid-`Bash`):
- TUI "■ Conversation interrupted". **Stop did not fire**, and `PostToolUse` of the interrupted call never arrived.
- Rollout, in order: `response_item` `custom_tool_call_output` "aborted by user after 7.4s"; `response_item` `message` with role `user` and text `<turn_aborted>…`; `event_msg` `turn_aborted` with `turn_id`, `reason: "interrupted"`, `started_at`, `completed_at` (epoch, seconds), `duration_ms`.
- Normal end: `event_msg` `task_complete` (`turn_id`, `last_agent_message`, `duration_ms`, `time_to_first_token_ms`). It is recorded **after** the Stop hook ends: the answer at 21:38:29.8, with a 12 s Stop hook `task_complete` at 21:38:42.0.
- Among Codex hook events there is no `Notification`: the Hooks panel lists PreToolUse, PermissionRequest, PostToolUse, PreCompact, PostCompact, SessionStart, SessionEnd, UserPromptSubmit, SubagentStart, SubagentStop, Stop. There is no hook witness of the prompt return.

Finding: an interrupted turn's end is visible only in the rollout via `turn_aborted`; Ctrl-C was not tried.

## T2. Mid-turn words

- TUI: "Messages to be submitted after next tool call (press esc to interrupt and send immediately)", the word stands queued.
- `UserPromptSubmit` arrived ~20 s after typing — when the word joined the turn on the step boundary (15 s before the `Bash` end), with the **same `turn_id`**. One Stop, `last_assistant_message` "BANANA DONE"; one `task_started`/`task_complete` in the rollout. Words join the running turn; the hook fires on joining, not on typing.

## T3. Words during the Stop hook

Stop hook slowed to 12 s:
- Words admitted. `UserPromptSubmit` fired **after** the Stop hook ended (12.2 s after Stop) with the **same `turn_id`**; then a second Stop with the same `turn_id` and `last_assistant_message` "APPLE". One `task_started` and one `task_complete` in the rollout (with "APPLE"). Stop does not end a turn with a word standing behind it; the turn's end is `task_complete`.
- Typing: text with `\r` as one PTY record arrived as a paste — Enter became a newline, words glued to the next prompt ("LATEWORDS say APPLEReply with only the word PONG."). Words and Enter typed as separate records works.

## T4. Longest call

200 s `Bash` (prompted "wait for it"): `PreToolUse` at 1.4 s, `PostToolUse` at 201.6 s, no hooks between; Stop after 0.7 s. The limit was not reached. The exec tool itself moves the terminal to the background after ~10 s ("1 background terminal running"), but at hook level this is one call until the process exits.

## T5. Transcript

- `transcript_path` — in every payload: `<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-<local time>-<session_id>.jsonl`; JSONL.
- Record: `{timestamp, ordinal, type, payload}`; `timestamp` ISO-8601 UTC with milliseconds on every record. Types: `event_msg` (`task_started`, `task_complete`, `turn_aborted`, `token_count`, `thread_settings_applied`, `item_completed`), `response_item`, `turn_context`, `token_usage_record`.
- Clocks are the same host's; server-time reconciliation and the guest environment were not measured. `started_at`/`completed_at` are epoch seconds.

## Codex background sessions

During the user session's turn Codex itself launched a "Memory Writing Agent" (model `gpt-5.6-terra`, its own `session_id`, cwd in `<CODEX_HOME>/memories`). Its `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse` went through the same hooks as the user session's, with a different `session_id` and `turn_id` (twice observed in this probe). Consequence: turn events arrive from sessions Tagma never opened; only `session_id` tells them apart.

## Not established

- Ctrl-C and interrupt in the thinking/streaming phase; `SubagentStart`/`SubagentStop` and the subagent marker in the payload.
- One call's upper limit; guest environment; clock skew; other models.
