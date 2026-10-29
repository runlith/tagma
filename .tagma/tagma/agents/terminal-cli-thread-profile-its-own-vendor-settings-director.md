---
id: 01a14b6d-b256-741e-ac32-e411b5a5f27c
title: "Terminal CLI thread profile: its own vendor settings directory, bare CLI with no Tagma inside, its own permission mode"
ord: 26
---
The operator sets what a new terminal thread of each CLI launches on, and the thread keeps it for life: its own vendor settings directory, a "bare" CLI with no Tagma inside, the CLI's own permission mode.

**The `threads.harnessProfile` setting** (per vendor: claude, codex, grok, devin, cursor, gemini):
- `home` — the vendor settings directory the CLI launches with (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`), instead of the logged-in account.
- `plain` — the CLI as shipped: Tagma installs no hooks, skill, or MCP server into it, gives no grant, and prints each assignment as its sender wrote it; Tagma still launches it, shows the terminal, delivers words, and reports each turn's end by reading the vendor transcript. Such a child cannot send messages: its answer to the parent becomes the run's last message.
- `permissionMode` — the CLI's own permission mode (for Claude Code: `auto`, `acceptEdits`, `bypassPermissions`, `manual`, `dontAsk`, `plan`) instead of the bypass Tagma usually launches it with; the CLI's permission screens then become questions to the thread's parent.

**Birth refusals.** A profile on a thread born over ACP — `profile-transport`. `home` for a CLI with no such directory — `profile-unsupported`. `plain` without its own `home` — `profile-home` (the default directory holds Tagma's hooks); `plain` for a CLI that names the transcript only after the session report — `profile-unsupported`. A CLI that has not finished its first launch in that `home` (theme, login) — `profile-home-setup` with the command to run. An unknown mode — `profile-permission`.

Code: apps/tagma/server/src/external-harnesses/settings.ts#harnessProfile, apps/tagma/server/src/external-harnesses/birth/profile.ts#profileOf, apps/tagma/server/src/external-harnesses/birth/seat.ts#birthSeat, apps/tagma/server/src/threads/approvers.ts
