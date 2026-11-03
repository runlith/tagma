---
id: 01a1a2a9-63db-7af0-9c74-d0e634b03f99
title: "The logins e2e world is an own runtime on a fresh machine: controlled claude and codex, nothing preselected"
ord: 47
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/logins.ts
---
`makeE2eWorld({ logins })` always builds an own world: the door fixture's bootstrap (provider token, account modes, chosen model, account CLI double, scripted model lend) preselects the very facts login discovery must find, so it is skipped, and the shared world's safety for ordinary e2e stays unchanged. The runtime uses the production account CLI and only the built-in adapters.

The `claude` and `codex` executables are shell scripts on `PATH`, written by the world. `PATH` is narrowed to directories holding no real `claude` or `codex`, and `PATH`, `CLAUDE_CONFIG_DIR` and `CODEX_HOME` are restored when the world's scope ends, so a world must not overlap another in one process. Status is per directory like the real CLIs: a directory Tagma makes starts signed out, and the fixture's login commands sign in the directory they run in.

The adapters' default places (the person's `~` for Claude Code, `~/.codex` for Codex) are relocated to fixture directories by wrapping the built-in declarations, so discovery, its file watch and native borrowing never read the real home. The wrapper changes addresses only; the adapters' parsers and readers are the production ones. `place: 'exported'` additionally exports the variables into the server environment so the explicit-directory row can be proved.

A held status blocks every start until the next answer, which is how a test observes the start and releases it. Codex's `app-server` renewal is not scripted.