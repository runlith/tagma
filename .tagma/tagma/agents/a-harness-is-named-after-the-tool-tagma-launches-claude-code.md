---
id: 01a1500b-4d81-7b31-b45c-30fbf77522dd
title: "A harness is named after the tool Tagma launches: `claude-code`, not `claude`"
ord: 85
tags: ["rule"]
fields:
  {
    "delivery": "code"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/external-harnesses
  - kind: dir
    ref: apps/tagma/server/src/threads/contract/wire/harness
  - kind: dir
    ref: apps/tagma/server/src/threads/harness
  - kind: dir
    ref: packages/adapter-anthropic
  - kind: dir
    ref: packages/adapter-cursor/src/harness
  - kind: dir
    ref: packages/adapter-devin/src/harness
  - kind: dir
    ref: packages/adapter-google/src/harness
  - kind: dir
    ref: packages/adapter-openai/src/harness
  - kind: dir
    ref: packages/adapter-opencode/src/harness
  - kind: dir
    ref: packages/adapter-xai/src/harness
---
Covers the harness id, the `harness:<name>` type, setting keys, and names in code. "Claude" is the model and provider a Tagma agent runs on; "Claude Code" is the CLI and its TUI.
