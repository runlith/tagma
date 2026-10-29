---
id: 01a10510-45fb-7c7a-9c43-d16d378e9604
title: "ACP by agent: Claude, Codex, Gemini, Cursor, Devin, Kimi, OpenCode, Copilot — what is declared, how each connects, where it is incomplete; Gemini probe, read 2026-10-04"
ord: 5
tags: ["research"]
fields:
  {
    "source": {
      "name": "The ACP registry nightly matrix, adapter and CLI sources (claude-agent-acp, codex-acp, gemini-cli, kimi-cli, opencode), Cursor/Devin/GitHub Copilot docs, live probes on the operator's machine",
      "ref": "registry fc1a2a6 (matrix 2026-10-03); claude-agent-acp a44c486; codex-acp ca1d971; gemini-cli 9a15c45 (locally 0.37.1); kimi-cli cbc15c0 (1.49.0; local binary 0.29.1); opencode 5a83358; docs.github.com/copilot (acp-server), docs.devin.ai/cli, cursor.com/docs/cli (2026-10-04). Probes of 2026-10-04 in the research-acp thread's scratch: gemini-acp-frames*.jsonl (session/new refused), claude-acp-frames.jsonl, cursor/devin/kimi-acp-initialize-frames.jsonl"
    }
  }
---
Read 2026-10-04. Every cell is marked with its source: **O** — own probe (`*-frames*.jsonl` frames in the research-acp thread's scratch); **M** — the registry nightly matrix of 2026-10-03 (CI, Linux); **S** — sources (clones in `.external/`); **D** — vendor docs. Empty or “not established” means unread, not absent. Cursor and Devin are covered in depth by separate readings; here only what comparison needs.

| Agent (version) | How it connects | Declared on `initialize` | Authentication | Session MCP servers |
| --- | --- | --- | --- | --- |
| Claude: `@agentclientprotocol/claude-agent-acp` 0.85.1 (Anthropic, Zed, JetBrains) over Claude Agent SDK 0.3.287 | `npx -y @agentclientprotocol/claude-agent-acp` (registry `claude-acp`) | **O/S**: `loadSession`, `list`, `resume`, `close`, `delete`, `fork`, `additionalDirectories`, `subagents`; `image`, `embeddedContext` (no audio); `providers:{}`; `auth.logout`; `_meta.claudeCode.promptQueueing`, root `_meta.steering.supported` | **O**: `authMethods` empty when the session is already logged in (my client never claimed `auth.terminal`); **S**: otherwise `terminal`-type methods (`claude auth login --claudeai` / `--console`) and gateway | **O**: stdio with `env` works; **S**: http, sse |
| Codex: `@agentclientprotocol/codex-acp` 2.1.1 over the Codex App Server (`@openai/codex` package) | `npx -y @agentclientprotocol/codex-acp` (`codex-acp`) | **S**: `loadSession`, `resume`, `list`, `close`, `delete`, `fork`, `additionalDirectories`, `subagents`; `image`, `embeddedContext`; `providers:{}`; `_meta.steering.supported` | **S**: `api-key`, `chat-gpt`, `chat-gpt-device-code` (if the client handles URL elicitation), `gateway` (if the client claimed `auth._meta.gateway`); **M**: `session/new` → `auth_required` | **S**: stdio, http; rejects `sse` and `acp` |
| Gemini CLI 0.62.0 (registry; 0.37.1 on the machine), native | `gemini --acp` (the `--experimental-acp` flag deprecated); registry: `npx @google/gemini-cli@0.62.0 --acp` | **O** (0.37.1): `loadSession` only; `image`, `audio`, `embeddedContext`; **M**: no `list`/`resume`/`fork` | **O**: 4 methods: `oauth-personal`, `gemini-api-key`, `vertex-ai`, `gateway` (the last with `_meta`); see below on the `session/new` refusal | **O/S**: stdio, http, sse; merge with the servers from `~/.gemini/settings.json` |
| Cursor 2026.10.01 | `cursor-agent acp` (registry: binary `./dist-package/cursor-agent acp`); docs say `agent acp` | **O**: `loadSession`, `list`; `image` (no `embeddedContext`, `audio`); **M**: no `resume`, `fork` | **O**: one `cursor_login` method; **D**: `agent login` beforehand, or `--api-key`/`CURSOR_API_KEY`, `--auth-token`/`CURSOR_AUTH_TOKEN`; **M**: `session/new` → `auth_required` | **O**: http, sse; **D**: MCP comes from `.cursor/mcp.json`; dashboard-level team servers unsupported in ACP; nothing said of `mcpServers` in `session/new` |
| Devin 3000.11.3 | `devin acp` (registry: binary `./bin/devin acp`) | **O**: `loadSession`, `list`, `delete`, `additionalDirectories`; `image`, `embeddedContext`; many `_meta["cognition.ai/*"]` | **O**: `devin-browser`; **M**: `agent` and `terminal`; **D**: `WINDSURF_API_KEY`, or the `devin auth login` store, or an `authenticate` request | **O**: http, sse; on `initialize` itself raised the MCP servers from `~/.config/devin/mcp_config.json` (in `initialize._meta.mcpConfigPath`), before `session/new` |
| Kimi CLI 1.52.0 (registry); local `kimi` binary — “Kimi Code CLI” 0.29.1 | `kimi acp` (registry: binary) | **M**: `loadSession`, `list`, `resume`; **O** (0.29.1): `image`, `embeddedContext`, `audio:false` | **M/O**: terminal `login` method (`kimi login`) | **O** (0.29.1): http, sse; **S** (1.49.0 clone): http, `sse:false` |
| OpenCode 1.18.34 | `opencode acp` (registry: binary) | **M/S**: `loadSession`, `list`, `fork`, `resume`, `close`; `image`, `embeddedContext` | **S**: `opencode auth login`; `_meta["terminal-auth"]` only if the client claimed it | **S**: http, sse |
| GitHub Copilot CLI 1.0.91 | `copilot --acp [--stdio | --port N]` (registry: `@github/copilot --acp`); separate `github-copilot` record 1.551.2 (`@github/copilot-language-server --acp`) | **M**: `loadSession`, `list` on both records | **M**: `terminal` on `github-copilot-cli`, `agent` on `github-copilot`; **D**: BYOK possible via `COPILOT_PROVIDER_*` | not established |

## Where the implementation is incomplete

- No `resume`: Gemini, Cursor, Devin, Copilot (both) — resume only via `session/load` with replay (**M**).
- No `list`: Gemini (**M**).
- `close` undeclared: Gemini, Cursor, Devin, Kimi (**O/M**); Copilot — not established.
- Missing in `prompt`: `embeddedContext` on Cursor (**O**), `audio` nearly everywhere (except Gemini).
- Nothing shared by all: model choice (`configOptions` with `category:"model"` on Claude versus the deprecated `models`/`session/set_model` on Gemini and Codex), mid-turn input (see “ACP: turn flow”), `rawInput` in permission requests (Claude has it, Gemini does not).
- Beyond this list the registry also has Goose, Qwen Code, Junie, Mistral Vibe, Grok Build (npx `@xai-official/grok agent stdio`) and others (42 records total; 35 in the matrix) — details in “ACP: agent registry”.

## Gemini probe: what came out

Gemini CLI 0.37.1 (`/opt/homebrew/bin/gemini --acp`), one process, `initialize` with `fs`/`terminal` = false. `initialize` answered in 7.5 s, then `session/new` with one stdio MCP server failed twice with `-32000`, and no prompt could be sent:

1. With the machine environment (`GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION` set): the provider text — `Permission 'cloudaicompanion.licenses.selfAssign' denied on resource '//cloudresourcemanager.googleapis.com/projects/…'`.
2. Without those two variables: `This client is no longer supported for Gemini Code Assist for individuals. To continue using Gemini, please migrate to the Antigravity suite of products: https://antigravity.google`.

The machine's chosen login type is `oauth-personal`; the second error is Google's server answer, not the protocol's. What remains: an API key or Vertex AI. The environment has no key, and `authenticate` rewrites the user's `~/.gemini/settings.json` (`security.auth.selectedType`), so it was never called. Frames: `gemini-acp-frames-attempt1-gcp-env.jsonl`, `gemini-acp-frames.jsonl`.

Live turn frames came from the Claude adapter (`claude-acp-frames.jsonl`): `initialize`, `session/new` with one stdio MCP server (`env` reached the process), one prompt “call `probe_echo`, then answer OK” → `tool_call` → `request_permission` (answered `allow-once`) → `completed` → `agent_message_chunk "OK"` → `end_turn`; spend per the agent's own accounting — 0.289 USD (`usage_update.cost`), 99929 tokens total (66154 from read cache).
