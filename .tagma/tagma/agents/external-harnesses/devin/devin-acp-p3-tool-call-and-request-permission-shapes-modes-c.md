---
id: 01a108dc-1aff-715d-acc8-24604c350a0c
title: "Devin ACP P3: tool_call and request_permission shapes, modes, cancel, second prompt, repeated answer, session lock"
ord: 4
tags: ["research"]
fields:
  {
    "source": {
      "name": "devin acp 3000.11.3, live turns of 2026-10-04: file write, shell, ask, cancel of sleep 60, second prompt mid-sleep 90, lock from a second process; frames probes/devin/s3*.jsonl, s5.jsonl, s6.jsonl, block*.jsonl",
      "ref": "scratch 01a10407-8719-764b-9fac-8b1d83b24de9/probes/devin/"
    }
  }
---
# Devin ACP P3: tool_call and request_permission shapes, modes, cancel, second prompt, repeated answer, session lock

Live probe of `devin acp` 3000.11.3, 2026-10-04, same stand as P2. Turns: file-write in smart and accept-edits, shell+write in accept-edits, echo in smart, refusal in ask, cancel of `sleep 60`, second prompt mid-`sleep 90`, lock from a second process. Raw frames: `probes/devin/s3*.jsonl`, `s5.jsonl`, `s6.jsonl`, `s7.jsonl`, `block2.jsonl`, `block3.jsonl`.

## Measured

**Shapes.** `tool_call`: `{toolCallId: "<tool>_<n>_<hex>#<hex>", title, kind?, rawInput?, content?, _meta}`. `kind`: `"edit"` for write, `"execute"` for exec, missing/`null` for `mcp_list_tools` and the first `mcp_call_tool` frame. `rawInput`: object `{file_path, content}` for write; JSON string `'{"command": "…"}'` for exec. `content` for exec: a `text/x-shellscript` resource with `uri: "tool://preview"` and `_meta.preview_is_shell_command`; `_meta` also carries `commandNames`, `inferenceToolName`, `cwd`, `terminal_exit {terminal_id, exit_code, signal}`. Write carries diff `[{type: diff, path, newText}]` (no oldText on create). `tool_call_update`: status `in_progress`/`completed`, the closing frame often content-free. The `tool_call` update arrives before `request_permission` (0.07 s on exec).

**`session/request_permission`.** Params: `{sessionId, toolCall: {toolCallId, _meta?}}`, exec adds `_meta.editableCommand`; no kind/title/rawInput in the request. The option set depends on context: MCP call — 7 options (see P2); `sleep 90` — 6 (`allow_once`, `allow_session`, `allow_always`, `allow_always_global`, `switch_bypass`, `reject_once`); `echo … > file` — 4 (`allow_once`, `switch_accept_edits`, `switch_bypass`, `reject_once`). Kinds seen: only `allow_once`, `allow_always`, `reject_once`; `reject_always` never observed.

**Modes.** accept-edits: exec asks (2/2), MCP call asks (1/1), write is `auto-decided Some(Allow)` by cog, no request (2/2). smart: write and safe exec (`echo`) are auto-decided Allow with no request. ask: the model refuses ("read-only, no file write/edit tool exposed"), no calls or requests. bypass was never driven live; its mode announcement is "Auto-approve all tool calls". Result: there is no mode that asks about every mutating call — file write passes without asking wherever it is permitted; accept-edits asks the most. Risky exec in smart was not checked.

**Cancel.** `session/cancel` is notification-only (as a request it answers `-32601`). On a running turn (`sleep 60`): `agent_stopped {cause: "cancelled"}` and the prompt answer `{stopReason: "cancelled"}` arrived 0.01 s after the notification; toolCalls/commandsRun counters are counted. Cancel after a finished turn is accepted and gives `agent_stopped cancelled` with empty counters.

**Second `session/prompt` mid-turn.** Accepted without error and does not wait for the turn end: the new message redirects the running turn (the model dropped `sleep 90` with no closing update and answered `SECOND`). Both ids resolve `end_turn` with one statistics each; two `turn_stats` arrive (one per `turnClientMessageId`) and one `agent_stopped complete`. The agent has no "after-turn" queue — the client holds it.

**Repeated answer to a closed id.** A duplicate answer to an already answered `request_permission` (same id, same optionId, +0.5 s): no answering frame, the turn continues. It is ignored.

**Lock.** Mid-turn `session/list` shows `_meta {isLocked: true, lockHolderPid: <pid of the devin acp process>}` (pid checked against `ps`). `session/load` of the same session from a second process: error `-32015 "already open in another process"`, `data {session_locked, lockHolderPid, retryable: true}`. After the turn `load` works: replay of history updates plus `modes`/`configOptions`, `_meta.isLocked: false`. The "live interactive CLI versus acp" pair was never driven directly (no TUI), but the lock lives in the shared session DB and does not depend on the holder. The `cwd` filter of `session/list` compares literally (`/var` ≠ `/private/var`) — the driver passes the real path. Bonus: `session/delete` exists, answers `{}`; all probe sessions were deleted, leaving an empty list check.

## Conclusion for the profile

The judge decides by `toolCallId` plus its own `tool_call` (the request is poor). Queue exec and MCP calls in accept-edits; write is visible only by observation. The driver never sends mid-turn words as a second prompt (it would divert the turn) but holds them until `stopReason`. Grace stop is minimal (cancel within hundredths of a second). Take over a session by replay after release; `session/load` of someone else's live turn refuses with a typed error.
