---
id: 01a1300a-d420-7b5a-a6b3-d89bec51f8e4
title: Install Claude Code and Codex CLI straight from the vendor section on the Providers screen
ord: 16
tags: ["idea"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a12c24-69a2-7f74-a6cf-a29052b10a62
---
A user without `codex` or `claude` currently sees only an "isn't installed" line in the section (for Codex, also the Tagma sign-in). The idea: install the CLI without leaving the screen — a Tagma terminal unfolds inside the section, runs the official install (`brew install --cask codex` or `npm install -g @openai/codex`; `curl -fsSL https://claude.ai/install.sh | bash`), then starts the CLI sign-in itself and folds away once the account row appears; on failure it stays with the error and "Try again".

To decide: how to pick an installer when neither Homebrew nor npm exists; whether to install globally or into the Tagma directory; how to show installer prompts (the Homebrew password); whether the same embedded terminal is needed for "Add account" in CLI-login mode. Decisions deferred by the operator on 2026-10-12.
