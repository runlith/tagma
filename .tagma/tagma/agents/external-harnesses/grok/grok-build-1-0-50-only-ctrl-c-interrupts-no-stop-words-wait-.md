---
id: 01a11d92-f15c-7933-a666-38876787fb19
title: "Grok Build 1.0.50: only Ctrl-C interrupts, no Stop, words wait for the turn end and the Stop hook, promptId at turn start and end, updates.jsonl with turn_completed — probe of 2026-10-08"
ord: 1
tags: ["research"]
fields:
  {
    "source": {
      "name": "Live T1–T5 probes in PTY: Esc and Ctrl-C on Bash and stream, mid-turn words, slowed Stop hook, 200 s Bash, on-disk updates.jsonl",
      "ref": "Grok Build 1.0.50 [stable] (1.0.46 launch updated), grok-4.5 low; 2026-10-08; scratch 01a11d5b…/probe (grok.hooks.jsonl)"
    }
  }
edges:
  - kind: discovered-from
    to: 01a11ca5-7ddf-7f42-a891-bd659b043055
---
Grok Build 1.0.50 (the CLI updated itself from 1.0.46 on the second launch; all model runs were on 1.0.50), Grok 4.5 model with `--reasoning-effort low` ("Grok 4.5 (low)" in the TUI), `--always-approve`, 2026-10-08, one host (macOS). Hooks — project `.claude/settings.json` in Claude format with a logger (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, Stop, StopFailure, SessionEnd, Notification); the transcript was read from disk. Tool: `node -e "setTimeout(…)"` via `run_terminal_command`. Measurements [[a621fbb3]], T1–T5.

## Hook payloads

Every event carries both key sets: `camelCase` (`hookEventName`, `sessionId`, `promptId`, `toolUseId`, `lastAssistantMessage`, `transcriptPath`) and `snake_case` (`hook_event_name`, `session_id`, `transcript_path`, …) — except `promptId`, `lastAssistantMessage`, `stopHookActive`, `reason`, `notificationType`, which are `camelCase` only. Every event carries `timestamp` (ISO-8601 UTC, microseconds).
- `UserPromptSubmit` and `Stop` carry **`promptId`**; `PreToolUse`/`PostToolUse` carry only `toolUseId`, no `promptId`. The Tagma profile counts Grok as turn-less (`turnOf: unturned`): the turn start and end have ids, tool calls do not.
- `Stop` carries `reason`: `end_turn` at the turn end, **`shutdown`** on process end (Tagma SIGHUP/SIGTERM), then `SessionEnd`.

## T1. Turn end on interrupt

- **Esc interrupts nothing**: neither a running `run_terminal_command` nor the text stream (two samples each) — the turn continued. **Ctrl-C interrupts** both.
- **No Stop fires on interrupt**, and no `PostToolUse` for the interrupted call arrives.
- Transcript (`updates.jsonl`): `turn_completed` with `stop_reason: "cancelled"` (a normal end has `end_turn`); on a stream interrupt the partial answer is recorded as one `agent_message_chunk` before `turn_completed`. `events.jsonl`: `{"type":"turn_ended","outcome":"cancelled","cancellation_category":"mid_turn_abort","cancellation_context":{"trigger":"ctrl_c"}}`.
- A `Notification` `idle_prompt` (`message: "Waiting for your next prompt"`) arrives **73 s** after Stop (two samples by payload marks: 72.7 and 73.3 s); untested after an interrupt.

Conclusion: a visibly interrupted turn ends in `updates.jsonl` as `turn_completed`/`cancelled`; Grok's interrupt key is Ctrl-C (`INTERRUPT_KEY`), not Esc.

## T2. Words mid-turn

A word is queued. `UserPromptSubmit` fired after the first turn's Stop (after the Stop hook ended), with a **new `promptId`**; a separate turn with its own Stop ("BANANA"). In `updates.jsonl` the same second holds `hook_execution` `user_prompt_submit` and `user_message_chunk`.

## T3. Words during the Stop hook

The Stop hook was slowed to 40 s: words typed inside the window were accepted. `UserPromptSubmit` arrived **exactly when the Stop hook ended** (22:07:50.97 with Stop at 22:07:09.9 and 40 s of sleep), with a new `promptId`, then that turn's Stop ("APPLE"). No losses. In `updates.jsonl` the normal-end order is: `hook_execution` `stop`, `agent_message_chunk`, `turn_completed` — within one second.

## T4. Longest call

`run_terminal_command` for 45 s: `durationMs` 45651. For 200 s ("do not background"): `PreToolUse` at 5.6 s, `PostToolUse` at 206.8 s (**201.2 s**), `isBackgrounded: false`, with no hooks between them. The limit was not reached.

## T5. Transcript

- `transcript_path` arrives on every event except `SessionStart`; it points at `~/.grok/sessions/<cwd, url-encoded>/<session_id>/updates.jsonl` (`session_id` is UUID v7).
- Alongside: `events.jsonl` (`{ts, type, …}`, `ts` ISO-8601 UTC with milliseconds; has `turn_ended` and `phase_changed`), `chat_history.jsonl`, `summary.json`, `usage.json`, `signals.json`.
- `updates.jsonl` — line-by-line ACP updates `{timestamp, method, params.update.sessionUpdate}`: `user_message_chunk`, `agent_thought_chunk`, `agent_message_chunk`, `tool_call`, `tool_call_update`, `hook_execution`, `turn_completed` (`prompt_id`, `stop_reason`). **`timestamp` is whole epoch seconds**, enough to bound a turn but not to order within a second. `hook_execution` and `turn_completed` carry `prompt_id`.
- Clocks are the same host's; skew against server time and the guest environment were unmeasured.

## Not established

- Esc in the thinking phase and in dialogs; other interrupt keys; `idle_prompt` after an interrupt.
- Subagents and their payload sign; guest environment; other models.
