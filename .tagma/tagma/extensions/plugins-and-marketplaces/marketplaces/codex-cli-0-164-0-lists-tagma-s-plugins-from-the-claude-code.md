---
id: 01a18a03-1f54-7609-b69d-a440fdb32684
title: Codex CLI 0.164.0 lists Tagma's plugins from the Claude Code list and the Codex manifests, and Claude Code 2.1.312 validates them — run 2026-10-30
ord: 7
tags: ["research"]
fields:
  {
    "source": {
      "name": "Codex CLI and Claude Code CLI",
      "ref": "codex-cli 0.164.0; Claude Code 2.1.312; runlith/tagma-plugins@ed6fee3ab70b7e826731c84506e323a0538a3c13"
    }
  }
edges:
  - kind: relates
    to: 01a1897e-a2d4-7c95-a8a8-939b43cce814
  - kind: relates
    to: 01a18a03-1ee2-7b59-af96-04ec1f42afc5
---
Run 2026-10-30 on macOS against `runlith/tagma-plugins` at `ed6fee3ab70b7e826731c84506e323a0538a3c13`.

**Claude Code 2.1.312.** From a fresh clone, `claude plugin validate --strict` passed on the marketplace root and on each of `plugins/linear`, `plugins/notion` and `plugins/sentry`. Its plugin-directory checks, which do not change the result, listed what Anthropic's directory asks of a submission beyond the format.

**Codex CLI 0.164.0.** With an empty `CODEX_HOME`, `codex plugin marketplace add <clone>` registered marketplace `tagma` from `.claude-plugin/marketplace.json` alone. `codex plugin list --available --json` listed `linear@tagma`, `notion@tagma` and `sentry@tagma`, each with source `local`, version `1.0.0` from its `.codex-plugin/plugin.json`, `installPolicy` `AVAILABLE` and `authPolicy` `ON_INSTALL`, which are the defaults: the Claude list names no policy. Without `--available` the command lists installed plugins only and answered empty.

`claude plugin validate --strict` passed again at `54ad879a4a3c4104b59bd9df62f770ca87c37335`, which changes only the text of the three skills.

**Not established.** No plugin was installed in either client. `codex plugin add` was not run, because `ON_INSTALL` may start the service's real sign-in, so Codex's reading of the manifest's `skills` and `mcpServers` was not observed. No session of either client ran.
