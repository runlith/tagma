---
id: 01a108dc-0468-79bf-b6f4-c2c515ea16b5
title: "Devin ACP P2: project MCP starts, no duplicate, hooks fire with env"
ord: 3
tags: ["research"]
fields:
  {
    "source": {
      "name": "devin acp 3000.11.3 (9c803229faa4), live turns of 2026-10-04: temp project with .devin/mcp_config.json and hooks; frames and scripts in probes/devin/s1.jsonl, s2.jsonl, s2b.jsonl",
      "ref": "scratch 01a10407-8719-764b-9fac-8b1d83b24de9/probes/devin/"
    }
  }
---
# Devin ACP P2: project MCP starts, no duplicate, hooks fire with env

Live probe of `devin acp` 3000.11.3 (9c803229faa4), 2026-10-04. Stand: a temporary project with `.devin/mcp_config.json` (a custom stdio `probe-echo` server on python3, stub `PROBE_SECRET=fake-secret-42`) and `.devin/hooks.v1.json` (all 7 events write a marker and env to a file). Two model tool-call turns (SWE-2 High) plus two sessions without turns. Raw frames and scripts: `probes/devin/s1.jsonl`, `s2.jsonl`, `s2b.jsonl`, `acpdrv.py`, `echo_mcp.py`, `s1_mcp_project.py`, `s2_mcp_both.py`, `s2b_mcp_which.py`.

## Measured

**Project MCP starts on its own.** `session/new` with `mcpServers: []`: the `probe-echo` server from the project config starts (`Starting stdio MCP server 'probe-echo': "python3" […]`, then `connected successfully`, further frames already carry the session's `sessionId`). User servers start too at the same time; no isolation was checked.

**The model sees the tool and calls it in two steps.** `mcp_list_tools` (auto-decided Allow, no request) returns `- probe_echo`; `mcp_call_tool` goes with `session/request_permission`. Shapes: `tool_call` without `kind` on the first frame, `_meta {inferenceToolName: "mcp__probe-echo__probe_echo", eventType: "mcp_tool_call"}`; the `request_permission` itself carries only `toolCall: {toolCallId}` without kind/title/rawInput. Options (7): `allow_once`/`allow_once`; `allow_session`, `allow_always`, `allow_server_session`, `allow_server_always`, `switch_bypass`/`allow_always`; `reject_once`/`reject_once`. The answer `allow_once` is confirmed in stderr as `grant=ApproveOnce`. The result arrives as `tool_call_update completed` with `content [{type: content, content: {type: text, text: '{"secret": "fake-secret-42"}'}}]` — the project config env arrived, and the model returned the value in its answer.

**The same server in `session/new.mcpServers` is not duplicated but takes over env.** One logical server: start at `session/new` and reconnect on first use (two consecutive Starting/connected pairs, no name-conflict messages). The live env comes from the ACP parameters (`via-acp-params`), not from the project file. No two hanging processes are visible in the logs.

**Project hooks fire in the ACP session.** For one turn with two calls (list + call) the log got: `SessionStart` ×1, `UserPromptSubmit` ×1, `PreToolUse`/`PostToolUse` ×2, `PermissionRequest` ×1, `Stop` ×1. Hook env: `DEVIN_PROJECT_DIR` and `CLAUDE_PROJECT_DIR` equal the project cwd, plus inherited process environment (this probe also carried my session's `TAGMA_SESSION_GRANT`/`TAGMA_SESSION_ACT` — the grant reaches children the same way as in the terminal). No session-id variable from Devin is in env.

## Conclusion for the profile

`session/new.mcpServers` stays empty: the project declaration (including the `tagma` server with the process-environment grant) starts on its own, and passing the same server as a parameter silently replaces its env. Every MCP tool call needs approval except list; the driver must never pick the `kind: allow_always` option.
