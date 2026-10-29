---
id: 01a15261-3425-77dc-a5fc-0edb5cacb6eb
title: "Codex CLI 0.162.0: shell call in hooks — `tool_name: Bash`, `tool_input.command`, `tool_response` as the output string — probe 2026-10-19"
ord: 3
tags: ["research"]
fields:
  {
    "source": {
      "name": "Live Codex CLI hooks probe: PreToolUse/PostToolUse of three shell calls (sed -n, rg, cat)",
      "ref": "codex-cli 0.162.0, gpt-6.1-sol, `codex exec`, macOS, 2026-10-19"
    }
  }
edges:
  - kind: discovered-from
    to: 01a151df-e920-73d7-9b09-09d576cf9bbf
  - kind: relates
    to: 01a11d92-f13e-70e0-a79e-313114005f86
---
Codex CLI 0.162.0, model `gpt-6.1-sol`, `codex --dangerously-bypass-approvals-and-sandbox --dangerously-bypass-hook-trust exec` in an empty git directory with a separate `CODEX_HOME` (only `auth.json` copied, `[features] codex_hooks = true`). The project `.codex/hooks.json` with a stdin logger on `PreToolUse` and `PostToolUse`. Without `--dangerously-bypass-hook-trust` hooks do not run: Codex runs only a hook whose hash is recorded in its `config.toml` `[hooks.state]` (in TUI — by confirming in the "Hooks need review" panel); in `exec` there is nobody to confirm.

## Observation

All shell calls are one tool; the `PostToolUse` shape (output of `sed -n 1,2p docs/notes.txt`):

```json
{"session_id":"…","turn_id":"…","transcript_path":"<CODEX_HOME>/sessions/2026/10/19/rollout-….jsonl","cwd":"<cwd>","hook_event_name":"PostToolUse","model":"gpt-6.1-sol","permission_mode":"bypassPermissions","tool_name":"Bash","tool_input":{"command":"sed -n 1,2p docs/notes.txt"},"tool_response":"alpha line\nbeta line\n","tool_use_id":"exec-<uuid>"}
```

- `tool_name` is `Bash` (not `exec_command`, as the model tool is called), `tool_input.command` is the command line as the model wrote it, without the `/bin/zsh -lc` wrapper.
- `tool_response` is a string: the call's whole stdout; there is no `stdout`/`stderr` object as in Claude Code. For `rg -n needle docs` the string is `docs/other.md:1:needle here\n`, for `cat docs/other.md` the file contents.
- `PreToolUse` carries the same fields without `tool_response`; `tool_use_id` matches across the pair.
- Every event carries `model` and `permission_mode`.

## Finding

The fields `claudePrinted` reads exist on Codex: `Bash`, `tool_input.command`, and the string `tool_response` it takes as the whole output. Codex needs no own parsing of the string.

## Not established

- What a failed call's `tool_response` (nonzero code, stderr) and a backgrounded call ("background terminal") look like.
- The TUI shape (`codex` without `exec`) was not captured; same build of the CLI, so a match is a finding, not an observation.
