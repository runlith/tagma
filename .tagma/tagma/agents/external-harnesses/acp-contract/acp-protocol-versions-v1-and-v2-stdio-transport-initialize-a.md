---
id: 01a1050f-ca5e-761d-8151-fdd8ce4ad67e
title: "ACP: protocol versions v1 and v2, stdio transport, initialize, authentication and session lifecycle, read 2026-10-04"
ord: 1
tags: ["research"]
fields:
  {
    "source": {
      "name": "Agent Client Protocol: github.com/agentclientprotocol/agent-client-protocol (docs/protocol v1 and v2, schema v1 1.24.1, schema v2 2.0.0-alpha.7), typescript-sdk 1.7.0, registry; Gemini CLI and Claude/Codex adapter sources",
      "ref": "agent-client-protocol 20361dd (2026-10-03); typescript-sdk 605f3e0; registry fc1a2a6; claude-agent-acp a44c486 (0.85.1); codex-acp ca1d971 (2.1.1); gemini-cli 9a15c45 (0.56 nightly). Live frames: Claude adapter 0.85.1 (initialize, session/new, prompt, session/load after restart) and initialize of Gemini 0.37.1, Cursor, Devin, Kimi 0.29.1: frame files in the research-acp thread scratch"
    }
  }
---
Reading of 2026-10-04. Unverified: behaviour of agents I did not launch; everything marked "from sources" was not run.

## Protocol versions

- The stable line is v1: `protocolVersion: 1` as an integer (only breaking changes move the number; new arrives as capabilities). Schema `schema/v1` = 1.24.1, the protocol repo is release 1.10.2 of 2026-10-01 (`CHANGELOG.md`).
- v2 is a draft: `schema/v2` = `2.0.0-alpha.7`. `docs/protocol/v2/migration.mdx` itself demands keeping v2 behind a flag and supporting v1 alongside; one connection speaks exactly one version, chosen in `initialize`.
- Measured: all 35 agents in the nightly registry matrix of 2026-10-03 answer `protocolVersion: 1` (`registry/.protocol-matrix/latest.json`); my probes of the Claude adapter, Gemini, Cursor, Devin, Kimi — also `1`. Met no agent on v2.
- TypeScript SDK `@agentclientprotocol/sdk` 1.7.0: the package root is v1; v2 only via `@agentclientprotocol/sdk/experimental/v2`; there is an experimental `http-client`, `ws-client`, `server`. Other SDKs: Rust (`agent-client-protocol`), Python, Kotlin, Java, plus community libraries (`docs/libraries/`).

## Transport

- stdio: the client launches the agent as a subprocess; JSON-RPC 2.0, one message — one line (NDJSON, no embedded `\n`); stdout is protocol only, stderr is agent logs (`docs/protocol/v1/transports.mdx`).
- Streamable HTTP and WebSocket are Active-status RFDs (`docs/rfds/streamable-http-websocket-transport.mdx`), not in the core. Outside the spec: Copilot CLI supports `--acp --port N` (TCP, same NDJSON; GitHub docs), the TS SDK has experimental HTTP/WS.
- v2 adds JSON-RPC batch in a stdio line (except `initialize`, `auth/login`, `session/new`, `session/resume`, `session/prompt`).
- Practical takeaway: every verified agent is a separate stdio process; one process serves many sessions (Gemini `AcpSessionManager.sessions`, Claude adapter `this.sessions`).

## initialize and capabilities (v1)

The client sends `protocolVersion`, `clientCapabilities`, `clientInfo`; the agent replies with the chosen version, `agentCapabilities`, `authMethods`, `agentInfo`. What is not named is not supported.

- Client: `fs.{readTextFile,writeTextFile}`, `terminal`, `auth.terminal`, `elicitation.{form,url}`, `session.configOptions.boolean`.
- Agent: `loadSession`, `promptCapabilities.{image,audio,embeddedContext}` (text and `resource_link` mandatory for all), `mcpCapabilities.{http,sse}` (stdio mandatory for all), `sessionCapabilities.{list,resume,close,delete,additionalDirectories}`, `auth.logout`. `session/fork` and `providers/*` are unstable/draft.

## Authentication (v1)

- The agent lists `authMethods`. Type `agent` (default when no `type`) — the client calls `authenticate{methodId}`, reply `{}`. Type `terminal` — the client itself launches the same agent program interactively with the method's `args`/`env` (needs `clientCapabilities.auth.terminal`), waits for exit 0 and reconnects; `authenticate` must not be sent for it. `logout` — when `auth.logout`.
- The spec does not say how to hand the secret to `authenticate`. In practice agents read the request `_meta`: Gemini — `_meta["api-key"]` and `_meta.gateway{baseUrl,headers}` (`acpRpcDispatcher.ts:106-160`); Codex — `api-key`, `chat-gpt`, `chat-gpt-device-code`, `gateway` methods, key in `CODEX_API_KEY`/`OPENAI_API_KEY` (`CodexAuthMethod.ts`).
- A session that failed verification is a JSON-RPC error, in the spec code `-32000` (`auth_required`). Measured: Gemini 0.37.1 returned on `session/new` just `-32000` with the provider error text, no structured `auth_required`.
- The registry requires the agent to return ≥1 `authMethods` on `initialize` (CI handshake); agent and terminal are accepted, `env_var` also occurs in the matrix.
- v2: `authenticate` → `auth/login`, `logout` → `auth/logout`, field `id` → `methodId`, mandatory `type`.

## Sessions

- `session/new{cwd, mcpServers, additionalDirectories?}` → `{sessionId, modes?, configOptions?}`. `cwd` is an absolute path, the base of relative paths regardless of the agent process cwd.
- `session/load{sessionId, cwd, mcpServers}` (`loadSession`): the agent must replay the whole history as `session/update`, then reply. `session/resume` (`sessionCapabilities.resume`, stable in v1): no replay. `session/close` — cancel work and free resources. `session/list{cwd?, cursor?}`, `session/delete`. v2: `session/load` removed, `session/resume` with `replayFrom:{type:"start"}` instead; list/close/resume mandatory if the agent declares `capabilities.session` at all.
- Modes and models. In v1 — `modes` and `session/set_mode` (removed in v2) and universal `configOptions` with `session/set_config_option{sessionId, configId, value}`; stable categories `mode`, `model`, `model_config`, `thought_level`. Measured on the Claude adapter 0.85.1: `session/new` returned `modes` and `configOptions` `mode`, `model`, `effort` (thought_level), `fast` (model_config), no `models`.
- A deprecated but live road: `models` in the reply and the `session/set_model` method — absent from schema 1.24.1, implemented by Gemini (`acpSessionManager.ts`), Codex (`LEGACY_SET_SESSION_MODEL_METHOD`); in the 2026-10-03 matrix `session/set_model` succeeded on 17 agents. Model choice cannot be had one way through ACP: both are needed.

## Measurements (one sample, not a distribution)

Claude adapter 0.85.1 via `npx`: `initialize` 6.3 s (cold npx), `session/new` 2.9 s, then prompt. Repeated process launch: `initialize` 0.9 s, `session/load` with replay 1.6 s. Frames: `claude-acp-frames.jsonl`, `claude-acp-frames-load.jsonl` in the research-acp thread scratch (on 2026-10-04).
