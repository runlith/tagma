---
id: 01a1050d-3999-7777-964b-7660904cee6b
title: "Devin ACP: live `devin acp` 3000.11.3 probe — handshake, session, one prompt, which methods exist and which do not"
ord: 2
tags: ["research"]
fields:
  {
    "source": {
      "name": "Installed devin 3000.11.3 (9c803229faa4), `devin acp` over stdio, Devin Pro account",
      "ref": "Probe of 2026-10-04 in a temporary directory; raw jsonl frames and scripts in ~/.tagma/scratch/01a10407-8719-764b-9fac-8b1d83b24de9/devin-probe/ (temporary store); one prompt on SWE-2 High; permission requests, cancel, and tools unchecked"
    }
  }
---
Live probe of `devin acp` (devin 3000.11.3, commit 9c803229faa4, macOS arm64, Devin Pro account), 2026-10-04, in a temporary directory outside the checkout. One real prompt ("Reply with the single word OK and nothing else.") on the default model; the rest is promptless calls. The probe client is a python script that writes every JSON-RPC frame with a timestamp.

Raw frames (jsonl: `{t, dir, frame}`, `dir` — `->` client, `<-` server, `stderr`) and scripts live in `~/.tagma/scratch/01a10407-8719-764b-9fac-8b1d83b24de9/devin-probe/` (a copy from the research-devin thread scratch; scratch does not outlive its threads, so this is no permanent store):
- `devin-handshake.jsonl` — initialize + session/new without a prompt;
- `devin-prompt.jsonl` — same plus one prompt (all turn events);
- `devin-methods.jsonl` — session/list, set_config_option, set_model, set_mode, cancel, resume, fork, close, load;
- `devin-config.jsonl` — session/list without cwd, set_config_option (legal value), cancel as notification;
- `acp_probe.py`, `acp_probe2.py`, `acp_probe3.py`; `models.json` — `devin models list --format json` output.

## Measured

**Handshake.** `initialize` with `protocolVersion: 1`, empty `clientCapabilities` (fs/terminal undeclared) — answer in 30 ms on a warm start (1.6 s on a first cold start: CLI launch plus team settings). Answer: `protocolVersion: 1`; `agentInfo: {name: "affogato", title: "Devin Agent", version: "0.0.0-dev"}`; `authMethods: [{id: "devin-browser", …}]`; `agentCapabilities`: `loadSession: true`, `promptCapabilities {image: true, audio: false, embeddedContext: true}`, `mcpCapabilities {http: true, sse: true}`, `sessionCapabilities {list, delete, additionalDirectories}`; `_meta` with `cognition.ai/*` extensions: `multiRootWorkspace`, `sessionListOrderBy`, `sessionRename`, `sessionShare`, `documentLifecycle`, `userEdits`, `terminalLifecycle`, `userConfig`, `userShellCommand`, `editableCommands`, `commandRevision`, `chains`, `megaplan`, `ruleMentions`; `result._meta.mcpConfigPath: ~/.config/devin/mcp_config.json`. Besides `loadSession` (from the ACP core) there is no `resume`, `close`, or `fork`.

**session/new** (`cwd`, `mcpServers: []`) — answer in 0.2–1.0 s depending on the user's MCP servers. Answer: `sessionId` of the "intriguing-bucket" kind (human-readable slug, not a UUID), `modes` (`accept-edits` "Code", `smart`, `ask`, `plan`, `bypass`; default `accept-edits`), `configOptions` — three selectors: `mode`, `model` (default `swe-2-high`; one value per family, e.g. `claude-opus-5-medium`, `gpt-6-astra-medium`; each with `_meta.cognition.ai/supportsImages`), and `thought_level` (`medium|high|max`, default `high`); `_meta {cognition.ai/isLocked: false, cognition.ai/lockHolderPid: null}`. After the answer and during the turn, `session/update` messages arrive: `config_option_update`, `current_mode_update`, `available_commands_update` (slash-command list with categories: `/login`, `/logout`, `/status`, `/ask`, `/plan`, `/code`, `/smart`, `/bypass`, `/compact`, `/context`, `/fast`, `/loop`, `/recap`, `/session-stats`, `/rename`, `/share`, `/mcp`, `/bug`, `/help`, `/workspace`).

**User config is mixed in.** With `mcpServers: []` in `session/new` the server itself raised MCP servers from `~/.config/devin/mcp_config.json` (chrome-devtools via `npx`, figma-desktop over HTTP): 17 `_cognition.ai/mcp/serversChanged` frames and 30 `_cognition.ai/output {channel: "MCP: …"}` frames in one handshake. So in this mode `devin acp` reads the user config, not just what the client gave. Isolation (`--config`, `HOME`/`XDG_*`) was not checked.

**One prompt** (`session/prompt` with one `text` block) on `swe-2-high`: 3.3 s to `agent_stopped`, `ttftMs: 3248`. Frames in arrival order: `session/update agent_thought_chunk` (reasoning), `agent_message_chunk` ("OK" in one chunk), `_cognition.ai/thinking_complete {durationMs, blockIndex}`, two `usage_update {used, size: 262000, _meta {inputTokens: 19108, outputTokens: 36}}` (the second with `cognition.ai/subagent_context {parentAgentId: "root"}`), `_cognition.ai/turn_stats` (`responseDimensions`: agent_messages, model "SWE-2 High", input/output/cached tokens), `_cognition.ai/agent_stopped {cause: "complete", stats {toolCalls, filesChanged, commandsRun, …}}`, and the answer `{stopReason: "end_turn", usage {totalTokens, inputTokens, outputTokens}, _meta {cognition.ai/userMessageId}}`. The empty request cost 19,108 input tokens — the agent system prompt and tools. There were no tool, permission, or file-edit events in this turn, so `tool_call`, `tool_call_update`, and `session/request_permission` shapes were unobserved.

**session/load** of an old session (after the process exited) — works: the server replays history as `session/update` (`user_message_chunk`, `agent_thought_chunk`, `agent_message_chunk`, `session_info_update {title}`, `usage_update` with `totalCreditCost` and `totalAcuCost`) and answers `modes`/`configOptions`. The same `session/list` without `cwd` returned both my session and the CLI session from `/opt/workspaces/runlith` ("Session 1") — session storage is shared with the interactive CLI. With `cwd` the filter compares literally: `/var/folders/…` did not find a session recorded as `/private/var/folders/…`.

**Model and mode choice inside the session.** `session/set_config_option {configId: "model", value}` with a listed value works and answers with new `configOptions`; an off-list value (`claude-sonnet-5-5-low`) is `-32602 "Invalid value … for config option 'model'"`. `thought_level` via the same method accepts a value without error (the effect was not checked). `session/set_mode` works (`ask`, `plan`), dispatching `config_option_update` and `current_mode_update`. The start model is `--model`/`DEVIN_MODEL` on `devin acp` (documented in `--help`, untried).

**Missing methods:** `session/set_model`, `session/resume`, `session/fork`, `session/close` — `-32601 Method not found`. `session/cancel` as a request is also `-32601` (in ACP it is a notification: sent as a notification the server silently accepted it, but never mid-turn in this probe).

## Not checked (cannot count as conclusions)

- `session/request_permission`, `tool_call`/`tool_call_update`, plan, file edits, and commands: need a prompt with a tool; the probe's allowed limit was one prompt.
- `session/cancel` mid-turn, input mid-turn (`prompt` while a turn runs; the docs have only the `/btw` slash command for a side question), parallel sessions in one process, `isLocked`/`lockHolderPid` locking when two processes open one session.
- Use of an MCP server passed in `session/new` (the probe's HTTP server was an unreachable address; no connection observed), `fs/*`/`terminal/*` as client capabilities: at startup the server prints the extended client-capability list to stderr (`terminal`, `fs.read/write`, `subagents`, `elicitation`, `partial_content`, `multi_root`, `local_tools`, `mcp`, `plugins`…) — all `false`; the source and way to enable them (most likely `clientCapabilities._meta`) are undetermined.
- Stream granularity: "OK" arrived in one chunk; behavior on long answers is unknown.
- `authenticate` with a `WINDSURF_API_KEY` key was untried: the probe ran on saved credentials.
