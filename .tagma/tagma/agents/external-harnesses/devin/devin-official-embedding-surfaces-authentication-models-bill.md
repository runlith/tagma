---
id: 01a1050c-6507-7986-a19f-568c8e9a1ff3
title: "Devin: official embedding surfaces, authentication, models, billing (docs, ACP registry, CLI 3000.11.3)"
ord: 1
tags: ["research"]
fields:
  {
    "source": {
      "name": "docs.devin.ai (llms.txt and CLI, Desktop, API, billing pages); ACP registry cdn.agentclientprotocol.com/registry/v1/latest/registry.json; installed devin 3000.11.3 (9c803229faa4)",
      "ref": "Reading via web and local `devin --help`, `devin acp --help`, `devin models list --format json`, `devin auth status` of 2026-10-04; no cloud API calls and no legal review"
    }
  }
---
Reading of 2026-10-04: docs.devin.ai (including `llms.txt`, `cli/reference/commands`, `cli/enterprise/devin-auth`, `cli/cloud`, `cli/acp/zed`, `cli/acp/jetbrains`, `desktop/acp`, `desktop/devin-local`, `cli/essential-commands`, `admin/billing/self-serve`, `admin/billing/usage`, `api-reference/*`), the ACP registry `cdn.agentclientprotocol.com/registry/v1/latest/registry.json`, installed `devin 3000.11.3 (9c803229faa4)` on this machine. Conclusions are kept apart from measurements.

## What Cognition offers for embedding

**Devin CLI** — a closed binary (171 MB, Rust; the `CognitionAI/devin-cli` GitHub repository holds README and workflows, no sources). Launch modes confirmed by `--help` and docs:
- interactive TUI (`devin`), one-shot `devin -p "…"` printing to stdout, `--prompt-file`, `-c`/`-r <id>` to continue, `--export [path]` (ATIF dialog after every turn);
- `--model <name>` (fuzzy: `opus`, `sonnet`, `codex`…; switches the session model with `-c`/`-r`), `--permission-mode auto|accept-edits|smart|dangerous` and `--sandbox` (seatbelt/bwrap), `--config <path>`, `--respect-workspace-trust false`;
- `devin acp` — ACP server over stdio (see the separate probe record), `devin acp --agent-type summarizer|review`, `--refusal-fallback <models>`;
- `devin acp --cloud` and `devin --cloud` — ACP relay to cloud Devin over WebSocket;
- `devin list --format json`, `devin models list --format json`, `devin auth status`, `devin mcp …`, hooks, skills, plugins, subagents, rules/AGENTS.md.

No CLI SDK was found in the docs.devin.ai index; the only "Python SDK" in the index is a federal one for analytics and ACU, unrelated to the agent.

**Devin Desktop / Devin Local.** Devin Local is "the same agent harness as Devin CLI" (docs.devin.ai/desktop/devin-local); Desktop launches it as `devin acp` via `~/.windsurf/acp/registry.json`. Desktop has no separate protocol for third-party clients in the docs.

**ACP registry.** `registry.json` at reading time holds `id: devin`, `version: 3000.11.3`, binary distribution (darwin/linux/windows × aarch64/x86_64) with `cmd: ./bin/devin`, `args: ["acp"]`, `license: proprietary`, `license_url` — Platform Terms of Service. The same version number as the installed CLI. Docs separately describe launching Devin as an ACP agent in Zed, JetBrains, and Xcode (`devin acp` as a subprocess).

**Cloud Devin API v3** — a different product: `https://api.devin.ai/v3/organizations/{org}/sessions` (create a session with a prompt, send a message, list), `cog_` keys — service user (Teams and Enterprise) or a user's Personal Access Token. A session runs on a Cognition VM, not in the local tree; the metric is ACU or plan quota. Docs separately say a PAT is accepted on "real-time endpoints such as the ACP live WebSocket", i.e. `devin acp --cloud` can authenticate with a PAT. How that WebSocket looks on the wire was not read.

## Authentication

- `devin auth login` — browser login (`--force-manual-token-flow` for SSH); the token lands in `~/.local/share/devin/credentials.toml` (`$XDG_DATA_HOME/devin/` when set) and per docs is "persistent and does not expire"; the file can be copied between one's own machines. Measured here: the file holds `windsurf_api_key`, `api_server_url`, `devin_webapp_host`, `devin_api_url` keys.
- `devin acp` takes its key from `WINDSURF_API_KEY`, else from saved credentials, else accepts the ACP `authenticate` request (at `initialize` it declares the `devin-browser` method); stderr at startup: "ACP_BACKEND not set. Will accept host credentials if provided, otherwise fall back to env vars and stored CLI credentials".
- Enterprise: a role with the "Use Devin CLI" permission; legacy Windsurf Enterprise — a separate per-user CLI-access flag.

## Models

`devin models list --format json` on this account (measured): 53 families, 721 options (rung × fast/priority × 1m). Cost marks print per 1M tokens (e.g. Opus 5: $5 in / $0.5 cached / $25 out; SWE-2: Free; Fable 5.1: $10/$0.25/$50). In an ACP session the model is a `configOptions` entry with `category: model`, values with no thought step (`claude-opus-5-medium`, `swe-2-high`…); the thought step is a separate `thought_level` (measured: `medium|high|max` for SWE-2). The list depends on the account and team settings (an admin can restrict it), so 53 is one account's sample, not a catalog.

## Billing

Self-serve: Free; Pro $20/mo (daily and weekly quota shared by cloud sessions, Devin CLI, and Devin Desktop; on-demand credits above); Max $200/mo (weekly quota, no daily); Teams from $80/mo (full seat $40, flex seat — shared credit pool only). Enterprise — ACU per order form; legacy Windsurf Enterprise — a credit model. For GPT models a ChatGPT Plus/Pro subscription can be linked, and then GPT spend goes there instead of Devin's quota. A single ACP session's spend metrics arrive in `_cognition.ai/turn_stats` and `usage_update` (`totalCreditCost`, `totalAcuCost` on `session/load`). The docs give no numeric Pro quota size.

## Third-party use terms

## What the reading did not establish

- Rate and parallel-session limits for the CLI are absent from the docs.
- The cloud ACP WebSocket protocol and how a `cog_` PAT relates to the local `credentials.toml`.
- Which models and features (Fusion, Adaptive) are available on non-Pro plans.
