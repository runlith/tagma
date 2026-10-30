---
id: 01a11d92-f128-7f29-9288-79ba04ba7dd7
title: "Devin CLI 3000.11.3: interrupt is double Esc with no Stop, words wait for the turn end, ATIF transcript is rewritten whole, get_output to 280 s — probe of 2026-10-08"
ord: 7
tags: ["research"]
fields:
  {
    "source": {
      "name": "Live T1–T5 probes in PTY: double Esc, mid-turn words, slowed Stop hook, exec and get_output, on-disk ATIF transcript",
      "ref": "Devin CLI 3000.11.3 (9c803229faa4), swe-2; 2026-10-08; scratch 01a11d5b…/probe (devin.hooks.jsonl)"
    }
  }
edges:
  - kind: discovered-from
    to: 01a11ca5-7ddf-7f42-a891-bd659b043055
---
Devin CLI 3000.11.3, model `swe-2` ("SWE-2 High" in the TUI), `--permission-mode dangerous`, 2026-10-08, one host (macOS). Hooks — project `.devin/hooks.v1.json` with a logger; the transcript was read from disk. Tool: `node -e "setTimeout(…)"` via `exec`. Measurements [[a621fbb3]], T1–T5.

## Condition that changes the probe

The whole hooks file is rejected when it holds an unknown event: Devin log "unknown variant `Notification`, expected one of `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `PostCompaction`, `SessionStart`, `SessionEnd`, `PermissionRequest`" — and then no hook works. Devin has no `Notification` or tool-refusal events. Devin also imports hooks from `~/.claude/settings.json` (the `config_importers` log).

## T1. Turn end on interrupt

Interrupt means double Esc ("esc twice to interrupt"). Two Esc as separate writes seconds apart worked once in two tries; two Esc in one write worked (one sample).
- **Stop does not fire**, neither mid-stream nor while waiting on a tool.
- Mid-stream: TUI "✱ Canceled. What should Devin do?". In the transcript the agent's partial answer is followed by a `source: "system"` step with `[Response interrupted by user]`.
- While waiting on a backgrounded command (`exec` had already returned "running in background"): no mark at all — the transcript's next step is immediately `user` with the next prompt.
- There are no prompt-return events (Notification).

Conclusion: an interrupt mid-phase is visible in a `system` step `[Response interrupted by user]`; an interrupt in the tool phase leaves no transcript mark.

## T2. Words mid-turn

A word waits in a queue ("1 queued … ↵ send now"). `UserPromptSubmit` fired 0.1 s **after** the running turn's Stop, with a **new `prompt_id`**; it is a separate turn with its own Stop (`last_assistant_message` "BANANA"). In the transcript a `user` step follows the "DONE" step.

## T3. Words during the Stop hook

The Stop hook was slowed to 12 s: words typed inside the window were accepted; `UserPromptSubmit` arrived right after the Stop hook ended (12.2 s after Stop), with a new `prompt_id`, then its own Stop ("APPLE"). No losses.

## T4. Longest call

- `exec` with `timeout: 60000` (picked by the model), command for 45 s: `PostToolUse` after 10.9 s answering "Command running in background with ID…". Tool description: without `timeout` the command goes to the background "after 10s idle or 30s total".
- Waiting goes to `get_output` (`timeout` up to 280000 ms per the tool description; values below 10 s are raised to 10 s): `PreToolUse` → `PostToolUse` **147.8 s** with `timeout: 280000` and a 150 s command; no hooks between them. The 280 s limit comes from the tool description; it was never reached.

## T5. Transcript

- The hook never passes the path: the payload carries `session_id` — the session's short name (e.g. splashy-quail); the transcript is `~/.local/share/devin/cli/transcripts/<session_id>.json`, next to `~/.local/share/devin/cli/sessions.db` (SQLite, `message_nodes`).
- Format — one ATIF-v1.7 JSON document: `steps[]` with `step_id`, `timestamp` (ISO-8601, microseconds, `+00:00`), `source` (`user`, `agent`, `system`), `message`, and for the agent `tool_calls`, `observation`, `metrics`. The file is **rewritten whole** on a step boundary (mtime lags the running turn), not appended.
- No end-of-turn mark: the agent's last step has empty `tool_calls`; an interrupt is a `system` step (see T1).
- Clocks are the same host's; skew against server time and the guest environment were unmeasured.

## Not established

- Ctrl-C interrupt; lone Esc in the tool phase; subagents (`run_subagent`) and their event sign.
- The upper `get_output` bound (reached 148 s); guest environment; other models.
