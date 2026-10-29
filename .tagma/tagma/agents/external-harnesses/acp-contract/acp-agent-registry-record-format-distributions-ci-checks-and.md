---
id: 01a10510-45e8-7656-b9db-e8602eb4e347
title: "ACP: agent registry — record format, distributions, CI checks and the nightly protocol matrix of 2026-10-03, read 2026-10-04"
ord: 3
tags: ["research"]
fields:
  {
    "source": {
      "name": "github.com/agentclientprotocol/registry (FORMAT.md, AUTHENTICATION.md, agent.schema.json, .protocol-matrix/latest.json, .github/workflows/protocol_matrix.py), RFD docs/rfds/acp-agent-registry.mdx",
      "ref": "registry fc1a2a6 (2026-10-04); matrix generated 2026-10-03T10:26Z, 35 agents. The network index cdn.agentclientprotocol.com never downloaded"
    }
  }
---
Read on 2026-10-04: a clone of `agentclientprotocol/registry` at commit `fc1a2a6` (2026-10-04), files `FORMAT.md`, `AUTHENTICATION.md`, `agent.schema.json`, `.protocol-matrix/latest.json` (2026-10-03 report), RFD `docs/rfds/acp-agent-registry.mdx` (status Completed). The network index never downloaded.

## Record format

One folder per agent: `<id>/agent.json` (plus optional `icon.svg`, `README.md`). Required fields: `id` (`^[a-z][a-z0-9-]*$`), `name`, `version` (stable `X.Y.Z`), `description`, plus `license_url` (except `dimcode`). Optional: `repository`, `website`, `authors`, `license`, `icon` (16×16 SVG, `currentColor` colors only).

`distribution` — one or more of:

- `binary`: `darwin|linux|windows` × `aarch64|x86_64` platform keys; each has `archive` (zip/tar.gz/tgz/tar.bz2/tbz2 URL or bare binary), `cmd`, `args`, `env`, `sha256` (optional). `.dmg`, `.pkg`, `.deb`, `.msi` installers unsupported; for binary the RFD requires builds for all three OSes.
- `npx`: `{package (with version), args, env}` — runs `npx <package> <args>`.
- `uvx`: `{package, args, env}`.

`preview` is exactly `{version, distribution}` with `X.Y.Z-preview.N`; it is cut from the main index and lands only in `registry-for-jetbrains-preview.json`, substituted for the stable record. Preview distributions are never launched or CI-checked.

## Index and checks

- Index: `https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json` (also `registry-for-jetbrains.json`, `registry-for-jetbrains-preview.json`); the `agent.schema.json`, `registry.schema.json` schemas sit there too.
- CI on every PR: schema, id uniqueness, icon, URL reachability, `sha256`, OS coverage, and a handshake: the agent starts and must return non-empty `authMethods` on `initialize` — type `agent` or `terminal`. The registry is only for agents with user authentication.
- Hourly — version auto-updates from npm, PyPI, GitHub releases; nightly (05:15 UTC) — the “protocol matrix”; `quarantine.json` removes an agent from the index with a cause (7 at read date: e.g. `qoder` — “ACP initialize fails”, `fast-agent` — “timeout 120s on initialize”).
- 42 records at read date: distribution methods — 23 npx, 19 binary, 2 uvx (an agent may have several).
- The registry stores neither the protocol version nor agent capabilities (the `capabilities`, `auth` fields removed 2026-02-04): only the handshake gives them.

## How a client installs and launches

Per record: `binary` — download the platform archive, verify `sha256` (if given), unpack, run `cmd args` relative to the unpack directory (as with Cursor: `./dist-package/cursor-agent acp`); `npx`/`uvx` — invoke the package manager. Records of agents of interest:

- `cursor` 2026.10.01 — binary from `downloads.cursor.com`, `cursor-agent acp`.
- `devin` 3000.11.3 — binary from `static.devin.ai`, `bin/devin acp`.
- `gemini` 0.62.0 (registry; 0.37.1 on the machine) — native `gemini --acp` (the `--experimental-acp` flag deprecated); registry: `npx @google/gemini-cli@0.62.0 --acp`.
- `kimi` 1.52.0 (registry); local `kimi` binary — “Kimi Code CLI” 0.29.1 — registry: binary `kimi acp`.
- `opencode` 1.18.34 — registry: binary, `opencode acp`.
- `github-copilot-cli` 1.0.91 — `copilot --acp [--stdio | --port N]` (registry: `npx @github/copilot --acp`); separate `github-copilot` record 1.551.2 (`npx @github/copilot-language-server --acp`).
- `claude-acp` 0.85.1 — `npx -y @agentclientprotocol/claude-agent-acp` (Anthropic, Zed, JetBrains authors) over Claude Agent SDK 0.3.287; `codex-acp` 2.1.1 over the Codex App Server (`@openai/codex` package); `grok-build` 1.0.49 — `npx @xai-official/grok agent stdio`.

## Nightly matrix 2026-10-03 (CI-measured, Linux)

The report covers 35 agents; `initialize` succeeds on 34 (one `process_error`), `protocolVersion` is 1 on all 34; `loadSession` is declared by every respondent except `amp-acp` and `corust-agent`. `session/new` without authentication: `auth_required` on 23, success on 8, error on 2 and `invalid_params` on 1, untried on 1. Methods answered with success: `session/list` — 23, `session/fork` — 10, `session/resume` — 11, `session/set_model` — 17, `session/stop` — 0 (`method_not_found` on 32). The probe (`protocol_matrix.py`) sends `initialize` with `terminal: true`, `fs: {readTextFile, writeTextFile: true}` and `_meta.terminal-auth: true`, and `session/new` with `mcpServers: []`; the report says nothing of `mcpCapabilities` and `promptCapabilities`. The report measures an agent's answer to a request in CI, not turn work: after `auth_required` no prompt was ever sent.
