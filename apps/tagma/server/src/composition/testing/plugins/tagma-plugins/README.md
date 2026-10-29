# Tagma plugins

Plugins for the services [Tagma](https://tagma.dev) connects to. Each plugin carries a skill on working with the service and the service's own remote MCP server, so an agent both reaches the service and knows how to work in it.

| Plugin | Service | MCP server |
| --- | --- | --- |
| `linear` | Linear issues, projects and comments | `https://mcp.linear.app/mcp` |
| `notion` | Notion pages and databases | `https://mcp.notion.com/mcp` |
| `sentry` | Sentry issues, events and releases | `https://mcp.sentry.dev/mcp` |

Every server signs in with OAuth as the person using it. No token is stored in this repository or passes through Tagma's servers.

## Install

**Tagma** lists this marketplace first in the Plugins section of its settings. Install a plugin from there, then sign in to its server.

**Claude Code**

```sh
claude plugin marketplace add runlith/tagma-plugins
claude plugin install linear@tagma
```

**Codex**

```sh
codex plugin marketplace add runlith/tagma-plugins
codex plugin add linear@tagma
```

## Layout

The marketplace list is `.claude-plugin/marketplace.json`, which Claude Code reads and Codex reads as well. Each plugin lives in `plugins/<name>/`:

- `skills/<name>/SKILL.md`, the skill;
- `.mcp.json`, the remote MCP server;
- `.claude-plugin/plugin.json`, the manifest Claude Code reads;
- `.codex-plugin/plugin.json`, the manifest Codex reads.

The skill and the server are written once and shared by both manifests.
