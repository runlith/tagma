---
id: 01a14c08-22b6-75de-88f8-5c0082a1e659
title: The operator logs into a provider and edits accounts from the terminal with the tagma auth command
ord: 19
tags: ["feature"]
fields:
  {
    "state": "partial"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/providers/cli/auth.ts
  - kind: file
    ref: apps/tagma/server/src/providers/cli/signIn.ts
---
**Value.** Login to a provider on a windowless machine or from a script.

**How.** `tagma auth <provider>` with login-path choice, `tagma auth remove`, and `tagma auth label`.

**Behaviour.** The command opens the browser itself or prints an address and device code; the API key and pasted code are entered in a hidden field; then it waits for confirmation, polling the server. It saves an API-key provider key by the same path as the window.

**Limits.** The command offers the `external-cli` path, but the Claude Code and Codex login starts only from a project, which the command does not pass, so the server refuses. The command description speaks only of subscription OAuth, although it also takes keys. There is no default-account choice, no account and key lists, and no login mode in it — those live in the window and in `tagma op`.
