---
id: 01a1050f-fe38-77cf-8806-0bac1249b48f
title: "Cursor: official embedding surfaces (CLI, ACP, SDK, SDK Bridge, Cloud Agents API), authentication, models, billing (docs, @cursor/sdk 1.0.35, CLI 2026.09.15-d2fe57e)"
ord: 1
tags: ["research"]
fields:
  {
    "source": {
      "name": "cursor.com/docs (cli/acp, cli/headless, cli/reference/*, sdk/typescript, sdk/bridge, api, cloud-agent/api/endpoints, models-and-pricing, llms.txt), cursor.com/help/models-and-usage/api-keys, npm @cursor/sdk 1.0.35, github.com/cursor/sdk-bridge v1.0.35 (docs/*), installed cursor-agent 2026.09.15-d2fe57e",
      "ref": "Reading via web and local `cursor-agent --help`, `acp --help`, `about`, `models`, `status` of 2026-10-04; SDK never launched (package downloaded, license read); stream-json never launched; cloud API never called; no legal review"
    }
  }
---
Reading of 2026-10-04: cursor.com/docs pages (CLI: `cli/acp`, `cli/headless`, `cli/reference/output-format`, `cli/reference/authentication`; `sdk/typescript`, `sdk/bridge`; `api`; `cloud-agent/api/endpoints`; `models-and-pricing.md`; `llms.txt`), the `models-and-usage/api-keys` help article, npm package `@cursor/sdk@1.0.35`, the `cursor/sdk-bridge` repository (release v1.0.35 of 2026-10-01, documents `docs/protocol.md`, `services.md`, `streaming.md`, `versioning.md`), installed `cursor-agent 2026.09.15-d2fe57e` (`--help`, `acp --help`, `about`, `models`, `status`). Conclusions are kept apart from measurements. A live ACP probe is in a separate record.

## What Cursor offers for embedding

Five surfaces. All reach hosted Cursor models: "local" everywhere means the local agent loop and files, not a local model (the SDK document says so directly).

**1. `cursor-agent` / `agent` CLI** — a closed Node bundle (the version directory weighs 592 MB), installed with `curl https://cursor.com/install`. Installed here: 2026.09.15-d2fe57e; `about` reports a newer 2026.10.01-e373342. Modes per `--help` and docs:
- interactive TUI;
- `-p/--print` with `--output-format text|json|stream-json` and `--stream-partial-output`; `--force/--yolo` permits edits and shell, without them changes are only proposed;
- `--mode plan|ask`, `--resume [chatId]`, `--continue`, `create-chat`, `--model`, `--list-models`/`models`, `--workspace`, `--add-dir`, `--sandbox`, `--auto-review`, `--approve-mcps`, `--worktree`;
- `agent worker` — a self-hosted Cloud-agent worker (personal "My Machines" without Enterprise, pool for Enterprise);
- hooks `.cursor/hooks.json`, `agent mcp …`, plugins, rules, skills.

`stream-json` format per docs: NDJSON, `system/init` events (`apiKeySource`, `cwd`, `session_id`, `model`, `permissionMode`), `user`, `assistant` (by default one event per whole message between tool calls; with `--stream-partial-output` deltas told apart by `timestamp_ms` and `model_call_id`), `tool_call` `started|completed` with `call_id` and a per-tool body (`readToolCall`, `writeToolCall`, …), final `result` with `duration_ms`, `result`, `session_id`, `request_id`. Docs say directly: `thinking` events are suppressed in print mode; on error the process exits nonzero, the stream may break off with no closing event, and the error text goes to stderr. Docs name no usage/token fields in `result`. I never launched this mode (the probe's single prompt went to ACP), so the format is per docs, unmeasured.

**2. `cursor-agent acp`** — an ACP server over stdio (JSON-RPC 2.0, NDJSON). Docs call it intended for "custom clients and integrations" and list JetBrains, Neovim (avante.nvim), Zed, and "custom editors", with a minimal Node client. What the docs promise: `initialize` → `authenticate` (`cursor_login`) → `session/new` | `session/load` → `session/prompt` → `session/update` → `session/request_permission` (answers `allow-once`, `allow-always`, `reject-once`; "if the client does not answer, tool execution may block") → `session/cancel`; modes `agent|plan|ask`; extensions `cursor/ask_question`, `cursor/create_plan` (blocking), `cursor/update_todos`, `cursor/task`, `cursor/generate_image` (notifications). Per docs MCP in ACP comes from the project or user `.cursor/mcp.json`; MCP servers of the command palette are not supported; the probe showed more (see the probe record).

**3. TypeScript SDK `@cursor/sdk`** (1.0.35, published 2026-10-01; Node ≥ 22.13; under Bun docs promise a flat `dist/bundled` build where the SQLite store is unavailable and `JsonlLocalAgentStore` is needed). Package license — "© Anysphere Inc. All rights reserved. Use is subject to Cursor's Terms of Service" (checked in the tarball). `Agent.create({ model, local: { cwd } | cloud: {...} })` → `agent.send()` → `Run` (`stream()`, `wait()`, `cancel()`, `steer()`, `conversation()`, `usage`). What the local runtime gives and the rest do not:
- `systemPrompt` replaces the main-loop system prompt (local only; enabled per account, otherwise the first `send()` fails with an error naming `--system-prompt`; not kept across `resume`);
- `local.customTools` — functions in the calling process, registered as the MCP server `custom-user-tools`, need no interactive approval; `mcpServers` inline (stdio/http/sse, replacing the creation servers for one `send`); `tools`/`disallowedTools` — the built-in allowlist, `tools: []` leaves the model with no tools;
- `local.settingSources` (`project|user|team|mdm|plugins|all`) — which `.cursor/` layers load; without it only inline servers load;
- `run.steer(text)` throws a message into a running turn (local only; result `complete_delivered` or `revert_to_followup`), `mode: plan|agent`, `local.force`;
- `usage` on events and totals: `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `reasoningTokens?`; `requestId` per send; `agent.getUsage()` — billed tokens and dollars (cloud only);
- local-agent state storage — SQLite or JSONL by default, or a custom `LocalAgentStore`; `Agent.resume(agentId)` from a new process;
- approvals: in headless mode "tool calls run without asking"; constrain with `sandboxOptions.enabled`, `autoReview` (a Cursor classifier; a blocked call fails without escalation), and file hooks (`.cursor/hooks.json`). There is no programmatic approval callback; hooks are file-only (`.cursor/hooks.json`);
- `args`/`result` schema of `tool_call` is "not stable"; only the envelope (`type`, `call_id`, `name`, `status`) is stable.

**4. SDK Bridge** (`cursor/sdk-bridge`, MIT repository license, but the binary embeds `@cursor/sdk`). A local Connect server on loopback (HTTP/1.1, not gRPC), protocol `sdk.v1` with a promise of additive changes; starts as a child process, line `cursor-sdk-bridge ready {…}` in stderr, per-process bearer from a file. Services: `SdkAgentService` (create/resume/send/observe/cancel…), `SdkCursorService` (me, models, repositories), `SdkBridgeControlService`, plus two services the adapter itself raises: `SdkCustomToolCallbackService` and `SdkStoreCallbackService`. The Python SDK (`cursor-sdk` on PyPI) talks to the same binary. This is the way to get the SDK from a process without Node; for Tagma (TS) importing `@cursor/sdk` directly is shorter.

**5. Cloud Agents API v1** (`https://api.cursor.com/v1`, public beta, "APIs may change before general availability") — agents in a Cursor VM or on self-hosted workers (`env.type: cloud|pool|machine`), create agent and run, SSE run stream with resume, cancel, artifacts, model list; default limit 20 requests/min per endpoint. It has no local execution in the working tree (except a worker you run yourself). The API-overview document and the SDK both stress: these are agent APIs, not inference or chat-completions; Cursor exposes no raw model endpoint for arbitrary calls.

## Authentication

- CLI: `agent login` (browser; `NO_OPEN_BROWSER=1` prints a URL), credentials kept locally; for automation — `CURSOR_API_KEY` or `--api-key`; ACP docs also mention `--auth-token`/`CURSOR_AUTH_TOKEN`, a flag absent from the installed build's `--help`.
- ACP: `initialize` declares the single method `cursor_login`; in fact the session is created on the CLI's saved login (probe).
- SDK and Cloud API: key only — a user API key from the dashboard or a service-account key (Team Admin keys unsupported); `Cursor.auth.login()` issues a key via browser for 90 days into `~/.cursor/sdk/auth.json`. The SDK "does not pick up the installed application credentials" — CLI login does not help it.

## Models and billing

- The catalog depends on the account and team. Measured on this account: `cursor-agent models` — 246 line-options (ids like `gpt-6.1-sol-high-fast`), ACP `session/new` — 43 families, option ids like `claude-sonnet-5-5[context=300k,reasoning_effort=high]`. The list holds Claude (Opus 5.5, 5, 4.x; Sonnet 5.5, 5; Fable 5.1, 5; Haiku 4.5), GPT (5.6 Sol/Terra/Luna, 5.5, 5.4, 5.3-codex …), Gemini, Grok 4.7/4.6/4.5, Composer 2.5, Muse Spark 1.3, Kimi K3, GLM. SDK and Cloud API serve the catalog via `Cursor.models.list()` / `GET /v1/models` with parameter descriptions; Cursor Router (`auto-smart`, `cost|balanced|intelligence` modes) — Teams and Enterprise only.
- Billing: two pools — Cursor Models (Grok, Composer; more generous) and Other Models (third-party, at the model's API price). Straight from the SDK document: SDK runs obey the same billing, request pools, and Privacy Mode as IDE and Cloud Agents; spend shows in the dashboard under the SDK tag; a service-account key bills the team, a user key the user's plan. There is no separate tariff page for CLI and ACP; the help implies only the same plan membership. Numeric plan quota sizes were not read.
- The BYOK help says all requests go through Cursor servers "for final prompt building". Consequence for Tagma: Cursor assembles the final prompt on every official path.

## Third-party use terms

## What the reading did not establish

- Rate and parallel-session limits for `agent acp` and local SDK; docs name only 20 requests/min for the Cloud Agents API.
- Whether `systemPrompt` is enabled on this account and on which plans (per docs it is "per account").
- Bun compatibility of the local runtime outside the stated flat bundle was not checked: the package was only downloaded and its license read; the SDK was never launched.
