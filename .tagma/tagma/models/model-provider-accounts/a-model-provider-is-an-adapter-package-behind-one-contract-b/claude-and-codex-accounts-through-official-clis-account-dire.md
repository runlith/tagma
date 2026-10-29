---
id: 01a12c46-ab9c-7595-ace5-ac3b69817bc0
title: "Claude and Codex accounts through official CLIs: account directory, environment and launch ports, quota from sessions"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12c47-00db-7c9c-bac5-59ee8891459b",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a12c24-69a2-7f74-a6cf-a29052b10a62
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/sessions/launch.ts
---
Sections "Claude sign-in and accounts", "Codex accounts", "No sign-in at the door", "Refresh check" of the spec [[52b10a62]]. An account is a `CLAUDE_CONFIG_DIR`/`CODEX_HOME` directory or "unset"; the environment port (the adapter declares `Set`/`Unset`, `external-harnesses` applies it in `sessions/launch.ts`); the launch port for `claude auth login`/`codex login` in the terminal and headless `claude -p '/usage'`; the Tagma layer (hooks, skill) into each account's directory (`hookFormat.ts`, `skillInstall.ts`, `targets.ts`); Claude quota from runner sessions' `rate_limit_event` into `AccountQuota.observe`; an existing sign-in is visible at once (`claude auth status --json`, `codex login status`). Done: the spec checks for accounts, doorstep sign-in and borrowed-account refresh pass.
