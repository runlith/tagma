---
id: 01a14bae-6720-7d62-897a-928c2ce92792
title: A thread keeps its accepted prompt; the operator sees it and refreshes it from the agent's current definition
ord: 4
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-928acad90fdf
  - kind: relates
    to: 01a14be4-2437-75af-92bd-b427b7bf6486
  - kind: supersedes
    to: 01a14b6d-b246-7dc5-9629-30a550809e7d
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/library/AgentLibrary.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/commands/refreshInstructions.commands.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/contract/wire/operations/agents.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/contract/wire/operations/context.ts
---
**Value.** The thread's behaviour never shifts under it when someone edits definitions or instructions; the operator sees the exact prompt the thread works with and decides when to pull it to the current one.

**How.** `read_thread_agent` and the "in this thread" mark in the Agent library; `refresh_thread_instructions` and the `/refresh-instructions` command.

**Behaviour.** The saved prompt is served byte for byte, not reassembled. Refresh re-reads the same-named definition and assembles the current overlays, section edits, capabilities and tools; the update also re-reads skills and instruction files and shows the thread's position against the project instructions. The running run keeps its own, the next one reads the new composition. An unchanged composition writes nothing; a deleted or invalid definition refuses, keeping the previous profile and prompt.

**Limits.** The update never changes the agent type, model, mode or conversation. Project law is never frozen at all: every model step resolves it anew.
