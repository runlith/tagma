---
id: 01a189aa-af2e-7912-a397-42e3a3c49abb
title: OpenAI plugin packaging, the Codex marketplace list and Codex hooks — read 2026-10-29
ord: 1
tags: ["research"]
fields:
  {
    "source": {
      "name": "OpenAI plugin build docs and Codex hooks reference",
      "ref": "developers.openai.com/plugins/build/plugins.md; developers.openai.com/codex/plugins/build.md; learn.chatgpt.com/docs/hooks.md"
    }
  }
edges:
  - kind: relates
    to: 01a1897e-a2d4-7c95-a8a8-939b43cce814
---
Read 2026-10-29 for the Codex plugin format and the marketplaces spec. No Codex client was run.

## Packaging

- A portable package has an Agent Plugins `plugin.json` at its root with `skills/`, `mcp.json` and `assets/`; identity and portable components stay at the root.
- OpenAI-specific settings — `interface`, `apps`, `hooks`, `onboardingSkill` — live in `extensions["com.openai"]`. When that is an object it replaces the whole `.codex-plugin/plugin.json` overlay as their source; the two are never merged. When it is absent, `.codex-plugin/plugin.json` supplies them as a compatibility fallback.
- `hooks/hooks.json` is discovered by default when the selected overlay declares no `hooks`; an explicit `hooks` — a `./` path, a list of paths, an inline object or a list of them, inside the root — replaces default discovery.
- `apps` maps registered MCP servers in `.app.json`; portable `mcp.json` servers declare a transport `type`, and auth sits under each server's `extensions["com.openai"].auth`.

## Marketplace list

`.agents/plugins/marketplace.json` (or a legacy `.claude-plugin/marketplace.json`): `name`, `interface.displayName`, and entries with `name`, `source`, `policy` (`installation`, `authentication`, `products`) and `category`. Sources are `local` (a `./` path or a plain string), `url`, `git-subdir` (`url`, `path`, `ref` or `sha`) and `npm`. An entry whose source cannot be resolved is skipped without failing the list.

## Hooks

Events `SessionStart`, `SessionEnd`, `SubagentStart`, `SubagentStop`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `Stop`, `Interrupt`. Matchers are regexes; tool names are `Bash` for shell, `apply_patch` (also matched as `Edit` or `Write`) for file edits, and `mcp__<server>__<tool>`. Stdin and the answer protocol are Claude Code's: exit 2 blocks with stderr, `hookSpecificOutput.permissionDecision`, `updatedInput`, `additionalContext`, `decision: block`. Commands get `PLUGIN_ROOT`, `PLUGIN_DATA`, `CLAUDE_PLUGIN_ROOT` and `CLAUDE_PLUGIN_DATA`. Timeouts default to 600 s; `SessionEnd` and `Interrupt` default to 1 s with a 3 s ceiling.

## Not established

- Whether Codex expands `${PLUGIN_ROOT}` in a legacy `.mcp.json`.
- How `policy.authentication` changes what Codex does at install.
