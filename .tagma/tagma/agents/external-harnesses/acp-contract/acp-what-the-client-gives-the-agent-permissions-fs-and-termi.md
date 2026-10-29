---
id: 01a10510-45f0-70e2-8417-ff7a19b0dc5f
title: "ACP: what the client gives the agent — permissions, fs and terminal, session MCP servers, cwd, environment, identity, read 2026-10-04"
ord: 4
tags: ["research"]
fields:
  {
    "source": {
      "name": "Agent Client Protocol: docs/protocol v1/tool-calls.mdx, v1/session-setup.mdx, v1/file-system.mdx, v2/migration.mdx, v1/v2 schemas, RFD mcp-over-acp, meta-propagation, custom-llm-endpoint; claude-agent-acp, codex-acp, gemini-cli sources; Cursor and Devin docs",
      "ref": "agent-client-protocol 20361dd; claude-agent-acp a44c486; codex-acp ca1d971; gemini-cli 9a15c45; cursor.com/docs/cli/acp and docs.devin.ai/cli (2026-10-04). Measured only on the Claude adapter 0.85.1: stdio server with env, permission request (claude-acp-frames.jsonl); Devin initialize (devin-acp-initialize-frames.jsonl). MCP HTTP headers and Gemini/Codex — from sources"
    }
  }
---
Read 2026-10-04. Measured — only on the Claude adapter 0.85.1 (stdio MCP with env); everything on MCP HTTP headers, Gemini, Codex — from schema and sources.

## Permissions: `session/request_permission`

- v1: `{sessionId, toolCall: ToolCallUpdate, options[{optionId, name, kind}]}`, `kind` ∈ `allow_once`, `allow_always`, `reject_once`, `reject_always`. The answer is `{outcome:{outcome:"selected", optionId}}` or `{outcome:{outcome:"cancelled"}}` (the client must answer every hanging request this way on `session/cancel`). The client may auto-answer per settings.
- What lands in `toolCall` is the agent's call, only `toolCallId` required. Measured on the Claude adapter: `name`, `rawInput` (`{"text":"hello"}`), `title`, `kind`, `_meta.claudeCode.{toolName, mcpServer:{name,source}}`, the `allow-once` / `allow-with-updates` (“don't ask for Probe Echo commands”, kind `allow_always`) / `reject` options. Gemini (from sources, `acpSession.ts:753-768`): `title`, `kind`, `locations`, `content` (for edits — a `diff` with `oldText`/`newText`), no `rawInput`; `optionId` holds its `ToolConfirmationOutcome` values. Cursor (docs): `allow-once`, `allow-always`, `reject-once`; with no answer the tool stays blocked.
- `optionId` strings belong to the agent; the client only knows `kind`. What “allow always” does is the agent's call: the Claude adapter appends a rule to settings, Gemini updates the policy (`updatePolicy`). Storage outside Tagma.
- The agent asks permission only per its own policy. The Claude adapter has `default`, `acceptEdits`, `plan`, `auto`, `bypassPermissions` modes (measured in the `session/new` answer) — in `bypassPermissions` there are no requests.
- v2: the request has a required `title`, optional `description` and `subject` (`tool_call` or `command{command, cwd, toolCallId?, terminalId?}`); an unknown outcome must not be read as consent.
- Separately, v1 stable: `elicitation/create` and `elicitation/complete` (the agent asks the user with a form or a URL; needs `clientCapabilities.elicitation`). The Claude adapter disables `AskUserQuestion` if the client never claimed form-elicitation.

## Client file system and terminal

- `fs/read_text_file{sessionId, path, line?, limit?}`, `fs/write_text_file{sessionId, path, content}` (need `clientCapabilities.fs`); `terminal/create{command, args, env, cwd, outputByteLimit}`, `terminal/output`, `terminal/wait_for_exit`, `terminal/kill`, `terminal/release` (needs `terminal`).
- Agents need not use them. Gemini swaps its `FileSystemService` for `AcpFileSystemService` if the client claimed `fs`; in the Claude-adapter 0.85.1 and Codex-adapter 2.1.1 sources I found no tool use of the client's `fs`/`terminal` (in the Claude adapter the methods are merely passed through) — the agent writes files itself. Choosing never to claim `fs`/`terminal` is compatible with every checked agent: my probes ran with `fs` and `terminal` = false.
- v2 drops `fs/*`, `terminal/*` entirely: “a client that needs to hand the agent files or commands does it with an MCP server in `mcpServers`” (`migration.mdx`).

## Session MCP servers

- `session/new.mcpServers[]` (and `session/load`, `session/resume`): stdio `{name, command (absolute path), args[], env[{name,value}]}` — required by every agent; `{type:"http", name, url, headers[{name,value}]}` with `mcpCapabilities.http`; `{type:"sse"}` with `mcpCapabilities.sse` (deprecated MCP). v2: every server requires `type`, SSE removed. Draft `type:"acp"` (MCP-over-ACP, `mcp/message`, RFD Draft) is supported by none of the read adapters (Codex explicitly `acp:false`).
- Measured (Claude adapter 0.85.1): the passed stdio server started, the request's `env` reached the server process (the tool returned `grant-env:grant-abc-123`), the model sees the tool as `mcp__<name>__<tool>`, a call in `default` mode required permission.
- Gemini: stdio, http, sse; request servers merge with `mcpServers` from user settings (`acpSessionManager.ts:293-326`), i.e. user MCP servers stay active; a stdio server's cwd is the session cwd.
- Codex adapter: stdio and http (`headers` → `http_headers`); rejects `sse` and `acp`; names are sanitized (`sanitizeMcpServerName`); on a name match with Codex-config servers dedup is possible (`shouldDeduplicateMcpConflicts`).
- Devin (measured): on `initialize` itself raised all MCP servers from `~/.config/devin/mcp_config.json` (in `initialize._meta.mcpConfigPath`), before `session/new`. Cursor (docs): MCP comes from `.cursor/mcp.json`; the docs say nothing of `mcpServers` in `session/new` — not established.

## Directory, environment, identity

- `cwd` is required and absolute; `additionalDirectories` — with `sessionCapabilities.additionalDirectories` (Claude, Codex, Devin declare it).
- ACP has no “session environment” channel besides `mcpServers[].env`/`headers` and `_meta`. The agent process environment is set by whoever starts it. One process serves many sessions — so a per-thread value either lives on the process or travels a session-scoped channel. The Claude adapter gives such a channel: the SDK request's `env` = `process.env` + `_meta.claudeCode.options.env` from `session/new`, and `_meta.claudeCode.options` generally passes into the Agent SDK `Options` (tools, disallowedTools, settings, mcpServers; hooks-functions cannot cross JSON) — from sources `acp-agent.ts:9256-9446`.
- `_meta`: root keys `traceparent`, `tracestate`, `baggage` are reserved for W3C trace context (RFD meta-propagation, Completed); own keys carry a domain prefix. No read agent passes ACP `_meta` into an MCP tool call's `_meta` — not established. An agent's MCP call carries no ACP `sessionId`.
- Conclusion (unmeasured for HTTP): MCP calls can be attributed to a thread only via the Tagma MCP server connection itself — a signed grant in the stdio server's `env` (verified on the Claude adapter) or in the http server's `headers` (per Codex/Gemini schema and code, never live-checked). The agent and its tools see the secret in `env` or `headers` — the trust boundary stays with Tagma.
- Model route override and model secrets: Draft `providers/list|set|disable` (Claude and Codex declare `providers:{}`); `authenticate` with `_meta` (Gemini api-key/gateway, Codex gateway); environment — Devin `WINDSURF_API_KEY`, Cursor `CURSOR_API_KEY`/`CURSOR_AUTH_TOKEN`, Codex `CODEX_API_KEY`/`OPENAI_API_KEY`.
- A side effect found by reading: Gemini `authenticate` writes `security.auth.selectedType` into the user's `~/.gemini/settings.json` (`acpRpcDispatcher.ts:162`). The Claude adapter reads `settingSources: ["user","project","local"]`: hooks from the CLI's user settings will also run inside the ACP session (from sources, never live-checked).
