---
id: 01a15fb9-c083-7c21-882b-8adc98c8b1e2
title: Grok takes Tagma hooks from its own `.grok/hooks/tagma.json`; a hook written for one CLI and launched by another stays silent
ord: 3
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a15f90-0721-7c72-be04-3eedd3668d90
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/vendors/grok/row.ts
  - kind: symbol
    ref: apps/tagma/server/src/external-harnesses/hooks/dispatch.ts
    symbol: foreign
  - kind: symbol
    ref: apps/tagma/server/src/external-harnesses/installs/skillInstall.ts
    symbol: installForUser
---
Grok Build reads hooks from its own files (project `.grok/hooks/*.json` and user `~/.grok/hooks/`). It reads Claude Code files (`.claude/settings.json`) only through the compatibility layer, which is turned off by `[compat.claude] hooks = false` or `GROK_CLAUDE_HOOKS_ENABLED`. Third-party tools write that setting themselves: on the probe machine Superset set it, and Grok 1.0.62 never launched a hook from `.claude/settings.json` ([[d3668d90]]). Without hooks Grok has no turn start or end, no transcript path (`transcript_path` arrives only in a hook payload), and no session adopt. So Tagma writes Grok records into `.grok/hooks/tagma.json` and `$GROK_HOME/hooks/tagma.json` (default `~/.grok`), while Claude Code keeps its own `.claude/settings.json`. The user file and the home variable (homeEnv, also the CLI profile home) are declared in the profile hook surface (`hooks.user`); they are not derived from the format: Grok's format matches Claude Code's, but the directories differ.

When the compatibility layer is on, Grok also launches `.claude/settings.json` records. It runs the same command from two files once, different ones each (live probe of 2026-10-21, [[d3668d90]]). Each file serves one CLI, so a command in it carries `--harness <cli>`, and the two files' commands differ. A hook written for one CLI can be launched by another. When the process environment publishes another CLI's session id in a variable (`GROK_SESSION_ID` for Grok), such a hook stays silent. Without that, every Grok event would arrive twice, the second time on Claude Code's behalf, together with `PermissionRequest`, which the Grok profile never sets. The event's own session id is compared, not the variable's presence: Claude Code launched from a Grok shell inherits `GROK_SESSION_ID`, but its events carry their own session.

Grok and Claude Code records earlier shared `~/.claude/settings.json` as common commands with no `--harness`, and such a hook cannot stay silent. So a user-layer install updates the CLI file even when that CLI is not found on the machine but the file exists. Otherwise a machine with only Grok would keep old shared records next to the new ones and every event would arrive twice.

Project Grok hooks, as before through `.claude`, work only in a trusted folder (`/hooks-trust` or `--trust`). Tagma never grants trust.
