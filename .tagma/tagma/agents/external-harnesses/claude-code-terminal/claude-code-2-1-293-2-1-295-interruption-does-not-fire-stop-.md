---
id: 01a11d92-f111-703b-a5d3-e97744dbe4a8
title: "Claude Code 2.1.293/2.1.295: interruption does not fire Stop, mid-turn words join the running turn, Bash 120 s, transcript with turn_duration and interruption mark — probe 2026-10-08"
ord: 2
tags: ["research"]
fields:
  {
    "source": {
      "name": "Live T1–T5 probes in PTY: Esc/Ctrl-C on Bash and stream, mid-turn words, slowed Stop hook, Bash timeout, transcript on disk",
      "ref": "Claude Code 2.1.293 / 2.1.295, claude-haiku-5-5; 2026-10-08; scratch 01a11d5b…/probe (hooklog.js, claude.hooks.jsonl)"
    }
  }
edges:
  - kind: discovered-from
    to: 01a11ca5-7ddf-7f42-a891-bd659b043055
---
Claude Code 2.1.293 (T1, T2, T4), 2.1.295 (T3, `idle_prompt`; the CLI updated itself on restart), model `claude-haiku-5-5`, `--dangerously-skip-permissions`, 2026-10-08, one host (macOS). Live runs in PTY; hooks — own logger in `--settings` (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, Stop, StopFailure, Notification, SubagentStop, SessionEnd), transcript read from disk. Tool: `node -e "setTimeout(()=>console.log(1),45000)"` in `Bash`. Scripts and logs lie in the 01a11d5b thread scratch and leave with it. Measurements [[a621fbb3]], T1–T5.

## Conditions that change the probe

- Inherited `CLAUDE_CODE_CHILD_SESSION`: the TUI writes "Transcript saving is off", hooks fire and yield `transcript_path`, but there is no file. Probes ran with `CLAUDE*`/`AI_AGENT` cleared from profile `exports`.
- A lone `sleep N` in the foreground the harness blocks and the model rewrites it as a background launch; a `for … sleep` chain blocks as a bypass. The long call in probes is `node -e setTimeout`.

## T1. Turn end on interruption

Observations (Esc and Ctrl-C gave the same):
- **Stop never fires** — neither on Esc mid-`Bash`, nor mid-text-stream, nor before the first token. `PostToolUse`/`PostToolUseFailure` of the interrupted call do not arrive either. `Notification` with `idle_prompt` after interruption did not arrive in 77 s of idle (until the next prompt).
- Mid-`Bash`: TUI "Interrupted · What should Claude do instead?", input field empty. Transcript tail — two `user` records 2 ms apart: `tool_result` with `is_error: true` ("The user doesn't want to proceed with this tool use…", `toolDenialKind: user-rejected`) and text "[Request interrupted by user for tool use]" with `interruptedMessageId` = the assistant message id with `tool_use`. No `system`/`turn_duration` records.
- Mid-text-stream: an `assistant` record with partial text (`stop_reason: null`), then `user` "[Request interrupted by user]" with `interruptedMessageId`.
- Before the first token (thinking phase, twice): `UserPromptSubmit` fired, no Stop, text returned to the input field; in the transcript the last record is the `user` one with this prompt and `attachment`, no interruption marks.
- A finished turn: after Stop hooks the transcript gains `attachment` `hook_success`, `system` `stop_hook_summary` and `system` `turn_duration` (`durationMs`, `messageCount`). An interrupted turn has no `turn_duration`.
- `Notification` `idle_prompt` arrived once: 60.2 s after the end of Stop hooks of the finished turn, `message: "Claude is waiting for your input"`, `prompt_id` of the last turn.

Conclusion (a conclusion, not an observation): Tagma sees the end of an interrupted turn only in the transcript — by "[Request interrupted by user…]"; the Stop hook is no proof for it. Return to prompt after interruption is not confirmed by `idle_prompt` (one sample).

## T2. Mid-turn words

- `UserPromptSubmit` fires at send time, with the `prompt_id` of the **running** turn, not a new one. One Stop for both messages, `last_assistant_message` holds the answer to both ("DONE\nBANANA").
- Transcript: `queue-operation` `enqueue` at send time; `queue-operation` `remove` with `reason: absorbed_mid_turn` and `attachment` `queued_command` (`humanTurn: true`) — 32 s later, after the tool result. The model read the words at the step boundary, but the hook arrived earlier: `UserPromptSubmit` with the marker does not prove reading.
- A background command that finished between turns opens a turn on its own: `UserPromptSubmit` with `<task-notification>…` text and a new `prompt_id`, with no operator words (in the transcript `queue-operation` `enqueue`/`dequeue`).

## T3. Words during the Stop hook

Stop hook slowed to 12 s:
- Words typed at 6.5 s are accepted: the screen shows "running Stop hooks 2/3" and "Press up to edit queued messages", `queue-operation` `enqueue` at once, `dequeue` 5.2 s later — when the Stop hooks ended.
- `UserPromptSubmit` fired at input time (inside the Stop-hook window) with the **previous** turn's `prompt_id`. The next Stop has a new `prompt_id` and `last_assistant_message` "APPLE"; the transcript `user` record carries a new `promptId`. So the words open a new turn, but the turn-start hook carries another turn's id.
- `stop_hook_summary` and `turn_duration` of the previous turn are recorded after the Stop hooks end, i.e. 12 s after the Stop event itself.

## T4. The longest call

- `Bash` without `timeout` and a 150 s command: `PostToolUse` after **120.17 s** (`duration_ms: 120169`), the command went to background, the model said so, the turn ended; then the background completion opened a turn on its own (`<task-notification>`). So the default is 120 s of silence between `PreToolUse` and `PostToolUse`.
- `Bash` with `timeout: 400000` and a 200 s command: `PostToolUse` after **202.7 s**, in the foreground, with no intermediate hooks. The `timeout` upper bound not measured; subagents (`Task`) not tried.

## T5. Transcript

- The path is in every hook payload: `transcript_path` = `~/.claude/projects/<cwd with / and . replaced by ->/<session_id>.jsonl`; JSONL, appended.
- Timestamps: `timestamp` ISO-8601 UTC with milliseconds on `user`, `assistant`, `attachment`, `system`, `queue-operation`; absent on top-level `file-history-snapshot` (inside it), `atis-latch`, `permission-mode`. Row order is not always monotonic in `timestamp` (`attachment` stamped a ms before the `user` recorded ahead of it).
- Clocks are the same host's as hooks; skew vs server time not measured (server and CLI on one machine). Guest environment not tried.
- End marks: normal — `system` `turn_duration` after `stop_hook_summary`; interruption — `user` "[Request interrupted by user…]" with `interruptedMessageId`; before the first token there is no mark.

## Undetermined

- Behaviour in a guest environment and sandbox (path, clock, file availability).
- The `Bash` `timeout` upper bound, `Task`/subagent lifetime, `SubagentStop` and `agent_id` in payloads (no subagents launched).
- `idle_prompt` stability after interruption: one sample.
- Other models and versions; one sample per variant.
