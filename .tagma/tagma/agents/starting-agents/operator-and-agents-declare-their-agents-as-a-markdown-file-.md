---
id: 01a14bae-6720-7d62-897a-928acad90fdf
title: Operator and agents declare their agents as a Markdown file in a personal or project library; apps bring their own
ord: 2
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: supersedes
    to: 01a14b6d-b23c-7d9e-a8f9-6863d6fef1c7
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/library/AgentDefinitionEditor.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/library/AgentLibrary.svelte
  - kind: file
    ref: apps/tagma/server/src/native-harness/agents/declared/files.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/agents/declared/plugins.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/agents/library.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/skills/agentDefinitions.ts
  - kind: symbol
    ref: apps/tagma/server/src/native-harness/agents/operations.ts
    symbol: NATIVE_AGENT_PAIRS
  - kind: symbol
    ref: apps/tagma/server/src/threads/contract/wire/operations/agents.ts
    symbol: AGENT_OPERATIONS
---
**Value.** The operator starts a custom agent — a role, narrowed capabilities and tools, a starting model, edits of the inherited prompt — with one Markdown file and launches it by name like a built-in.

**How.** The Agent library in the app: view, edit, create from another agent, prompt preview; operations `read_agent`, `save_agent`, `read_agent_library`; the `agent-definitions` skill explains the format to agents.

**Behaviour.** Floors: built-in agents, personal ones in the server data directory, project ones in `.agents/`, app ones — read-only and only where the app is on. An agent either extends a built-in, narrowing its capabilities and editing prompt sections, or stands alone with its own identity. Preview assembles the prompt and the tool catalog without launching. A personal file shadows a project one of the same name.

**Limits.** A change takes effect on a new thread and preview at once; an existing thread takes the current definition through refresh for the next run, and a running run holds its open instructions. An edit whose section is gone breaks the thread's first run, so previews are made in the project where the agent will work. A name does not repeat a built-in agent or CLI.
