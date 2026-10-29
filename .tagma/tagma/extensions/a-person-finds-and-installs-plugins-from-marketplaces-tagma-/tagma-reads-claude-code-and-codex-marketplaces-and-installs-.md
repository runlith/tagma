---
id: 01a18975-644d-7413-ab91-26fc38643816
title: Tagma reads Claude Code and Codex marketplaces and installs a plugin from an entry
ord: 1
tags: ["spec"]
fields:
  {
    "status": "open"
  }
---
## What the person gets

The person or an agent adds a marketplace by its git URL or a folder, reads its entries, and installs a plugin from an entry with the consent the install already asks. Anthropic's and OpenAI's marketplaces stand in the list from the first start, and the person can remove them. An installed plugin remembers its marketplace, so updating it follows the marketplace's current version of that entry.

## Today

`install_plugin` takes a folder or a git URL (`plugins/sources.ts`, `PluginSource`). A git URL is cloned whole with `--depth 1`; there is no subdirectory, ref or commit. A plugin directory is read by two format adapters, `plugin-formats/claude-code` and `plugin-formats/agent-plugins`.

## Design

**List formats are adapters.** The marketplaces module owns added marketplaces, their fetched lists, and installs from an entry. It reads a list through an adapter per format, and its core names no format.
- **Claude Code list.** Its entry sources are a relative path inside the marketplace repository, `url` (a git URL with an optional `sha`) and `git-subdir` (a URL, a `path`, and an optional `ref` and `sha`). An entry with `strict: false` declares its own components and needs no manifest in the plugin.
- **Codex list.** Its sources are `local` (a `path`), `url` and `git-subdir`. Its entries carry `policy` and `interface`.
- **Shared rules.**
  - The builder reads each format's current definition before building.
  - An entry whose source kind an adapter does not know is listed with the reason and cannot be installed.
  - A pinned `sha` is honoured: what installs is that commit, or nothing.

**The Codex plugin format is a third plugin adapter.** OpenAI's plugins use `.codex-plugin/plugin.json`, beside `.mcp.json`, `.app.json`, `skills/` and `assets/`. On 2026-10-29, 31 of the 62 local plugins carried a `.mcp.json` naming the vendor's remote server (Linear's names `https://mcp.linear.app/mcp`, `type: http`), and 8 carried a ChatGPT app with no MCP server.
- Its skills and remote servers are taken. Remote servers sign in through the MCP layer.
- `.app.json` is listed as ignored, with the reason that it names a ChatGPT connection.
- Hooks under `extensions.com.openai` of an Agent Plugins manifest are read where their format matches the hook contract Tagma runs, and are listed as ignored otherwise.

**Sources.** A plugin installed from a marketplace records its marketplace and entry name, and its resolved git URL, subdirectory and commit. Updating re-resolves the entry from the marketplace's current list. Plugins installed from a folder or a git URL keep working unchanged.

**Fetching.**
- A marketplace's list is fetched when it is added and when the person refreshes it. Each marketplace is kept as a shallow clone in the machine data directory.
- Any other refresh cadence gets its driver in the same change.
- Removing a marketplace keeps the plugins installed from it, each with its recorded source. Such a plugin no longer updates.

**Trust.**
- Each marketplace carries a label: `tagma`, `vendor` for the preset Anthropic and OpenAI marketplaces, or `unreviewed` for any the person adds.
- An entry shows its author, repository and marketplace before install.
- Consent stays as `install_plugin` computes it: execute for stdio servers and hooks, network for remote servers.

**Operations.**
- `add_marketplace` and `remove_marketplace` are operator-only.
- `refresh_marketplace` and `read_marketplaces` (its entries, each with its install state) are open to agents.
- `install_plugin` takes a marketplace entry as a source, and its consent is unchanged.

## Owners

- **New `marketplaces` server module**, with list-format adapters in their own modules.
- **`plugins`**: the source kind, installs and updates from an entry.
- **New `plugin-formats/codex` adapter.**
- **The settings of the presets.**

## Acceptance

Fixture marketplaces are git repositories in the test world, one per list format, installed through the operations.
- **Install from each source kind.** A relative, `url` and `git-subdir` entry each install, a pinned `sha` installs that commit, and a `strict: false` entry installs its declared components.
- **The Codex plugin format.** A Codex-format plugin installs with its skills and its remote server, and `.app.json` is listed as ignored.
- **Unknown source kinds.** An unknown source kind is listed with its reason, and installing it is refused.
- **Updates.** An entry whose list moves to a new version updates to it.
- **Removal.** Removing the marketplace keeps the installed plugin.
- **Presets.** A fresh data directory lists the two vendor marketplaces with label `vendor`.
