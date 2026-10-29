---
id: 01a1897e-a2d4-7c95-a8a8-939b43cce814
title: Claude Code and Codex plugin marketplace and package formats — read 2026-10-29
ord: 7
tags: ["research"]
fields:
  {
    "source": {
      "name": "Claude Code marketplace reference; anthropics/claude-plugins-official; openai/plugins",
      "ref": "code.claude.com/docs/en/plugins/marketplace-reference; anthropics/claude-plugins-official@f8c5e7a1dcb71b10cb74586224b5401f3de5db28; openai/plugins@0722921d5542fc593105c27bd52630babd8b8c2a"
    }
  }
---
Read 2026-10-29 for Tagma reading plugin marketplaces and installing from them.

Sources:
- the Claude Code marketplace reference (https://code.claude.com/docs/en/plugins/marketplace-reference);
- `anthropics/claude-plugins-official` at `f8c5e7a1dcb71b10cb74586224b5401f3de5db28`;
- `openai/plugins` at `0722921d5542fc593105c27bd52630babd8b8c2a`.

Neither client was run.

## Claude Code list

**The file.**
- It lives at `.claude-plugin/marketplace.json`, and the directory holding `.claude-plugin/` is the root that relative sources resolve from.
- `name`, `owner` and `plugins` are required. Unknown top-level and entry keys are ignored, and each entry is validated on its own, so one invalid entry does not fail the list.
- Marketplace names imitating Anthropic's official ones are reserved unless the marketplace comes from `github.com/anthropics/`.

**Entry sources.**
- A relative path must start with `./` and must not contain `..`.
- The object kinds are:
  - `github`: `repo` as `owner/repo`, plus `ref` and `sha`;
  - `url`: a git URL, plus `ref` and `sha`;
  - `git-subdir`: `url`, `path`, `ref` and `sha`;
  - `npm`;
  - `archive`: an HTTPS zip with `sha256`;
  - `command`: a shell command run on the user's machine.
- `sha` is a full commit and wins over `ref`.

**An entry and the plugin's own manifest.**
- With no `.claude-plugin/plugin.json`, the entry is the manifest whatever `strict` says. Its `mcpServers`, `userConfig` and the other manifest fields apply.
- With a manifest and `strict: true` (the default), the entry's component fields `commands`, `agents`, `skills`, `hooks`, `outputStyles` and `themes` are appended to the manifest's. Entry `hooks` replace the manifest's per event.
- With a manifest and `strict: false`, an entry declaring any component field is a conflict, and the plugin fails to load. Entry `mcpServers` and `userConfig` never apply when a manifest exists.
- Display fields set on the entry win over the manifest's. Before install, only a relative-path entry's manifest can be read.

**Counts.** The official list holds 315 entries: 53 relative, 164 `url` and 98 `git-subdir`.

## Codex list and plugins

**The list.** It lives at `.agents/plugins/marketplace.json`.
- `openai/plugins` names it `openai-curated`, displayed as "Codex official".
- Its 65 entries carry `name`, `source`, `policy` (`installation`, `authentication`, and in 15 of them `products`), `category`, and in 3 of them `interface`.
- Their sources are 62 `local` (`{source: local, path}`), 2 `url` and 1 `git-subdir`.

**A local plugin.**
- `.codex-plugin/plugin.json` carries `name`, `version`, `description`, `author`, `homepage`, `repository`, `license`, `keywords`, an `interface` object (display name, logo, brand colours, default prompts, policy links), and paths to `mcpServers` and `apps`.
- Beside it may stand `.mcp.json`, `.app.json`, `skills/` and `assets/`.
- `.mcp.json` names remote servers as `{type: http, url, oauth_resource}`. Linear's: `https://mcp.linear.app/mcp`, with the same resource. Notion's: `https://mcp.notion.com/mcp`, with resource `https://mcp.notion.com`.
- `.app.json` names ChatGPT app ids.

**Counts over the 62 local plugins.**
- 46 carry skills.
- 31 carry `.mcp.json`, and 36 carry `.app.json`.
- 8 carry an app and no MCP server.
- 1 carries hooks.

## Not established

- How many of Anthropic's entries carry MCP servers, hooks or agents.
- OpenAI's root Agent Plugins manifest with an `extensions.com.openai` overlay: no plugin in this repository uses it. Its definition was not read here.
