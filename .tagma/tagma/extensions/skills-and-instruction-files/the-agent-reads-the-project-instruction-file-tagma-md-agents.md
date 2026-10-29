---
id: 01a14c08-8336-7b3c-965a-b08e54c003ed
title: The agent reads the project instruction file — TAGMA.md, AGENTS.md or CLAUDE.md — from the checkout root
ord: 5
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-928c2ce92792
  - kind: relates
    to: 01a14c08-8335-7c28-8f6b-267b0bb6f81f
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/contract/wire/sourceSettings.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/inputs/walk.ts
  - kind: file
    ref: packages/agent-sources/src/ContextFiles.ts
---
**Value.** A project that already described itself to agents in `AGENTS.md` or `CLAUDE.md` rewrites nothing for Tagma: a Tagma agent reads the same file.

**How.** The workspace-sources walk finds in the checkout root the first existing file from the `agent.contextFiles.names` list (by default `TAGMA.md`, `AGENTS.md`, `CLAUDE.md`) and puts it into the agent context; `agent.contextFiles.enabled` switches reading off.

**Behaviour.**
- Name order is priority: one directory yields one file, the first found.
- The law block that `tagma install` writes into this file for foreign CLIs is cut from the text: the native agent gets the law its own way and does not read it twice.
- When the file is re-read is decided by the same `skills.rescan` as for skills.

**Limits.** Only the checkout root where the thread stands is read: files in nested directories and the operator's personal file outside the project are not read, although the `agent-sources` package can do it — the server passes it neither a working directory nor personal directories. An unreadable file refuses the turn with a path.
