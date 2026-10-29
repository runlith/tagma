---
id: 01a14b6d-b246-7dc5-9629-30a550809e7d
title: Thread keeps the prompt it was born with; the operator sees it and pulls the thread to current instructions
ord: 23
---
A thread works with the system prompt it was born with, even when definitions and instructions have changed since. The operator sees this prompt byte for byte and can pull the thread up to what the server and checkout hold now.

**How.** `read_thread_agent` — the exact frozen prompt and birth overlay, not a rebuild from current files; if exact tool schemas were not stored beside it, the catalog answers `null`. In the Agent library a thread opens with the "In this thread" mark ("Definition held at birth", "Saved bytes") and a "View current definition" button. `refresh_thread_instructions` and the `/refresh-instructions` command: forget the memorized skills and checkout instruction files, replace the frozen prompt where the text now differs, and say where the thread stands against the project instructions.

**Limits.** A running run keeps what it opened with and is not interrupted: the next run reads the update. A repeat over unchanged instructions answers `current` and writes nothing. Conversation, agent, model, and approval mode do not change; loading a skill stays the run's own act. Project instructions are never frozen at all — every model step resolves them anew.

Code: apps/tagma/server/src/native-harness/contract/wire/operations/agents.ts, apps/tagma/server/src/native-harness/contract/wire/operations/context.ts, apps/tagma/app/src/lib/features/threads/native/commands/refreshInstructions.commands.ts, apps/tagma/app/src/lib/features/threads/library/AgentLibrary.svelte
