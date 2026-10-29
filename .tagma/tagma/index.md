---
id: 01a0bf97-a4f7-7e8b-bc09-a20c4d2ff254
title: Tagma
ord: 1
---
Tagma keeps a project's knowledge as one graph, sourced to the code it describes, and runs the agents that read and write it.

Stack: Bun, TypeScript, Effect 4, Svelte 5, Electron and SQLite via Drizzle.

- `apps/tagma/` — server and CLI, app, desktop shell and inspection runner.
- `packages/` — the shared packages Tagma is built from.
- `checks/` — architecture, Effect and lint checks.
- `brand/` — visual assets.
- `scripts/` — development and verification commands.

Tagma's own agents write its code and this graph; the operator sets tasks and makes decisions.
