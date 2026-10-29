---
id: 01a14b6d-b1d3-7a33-98dd-a3bc712ced40
title: Operator opens a thread as any agent offered to them — built-in, file-declared, or someone else's CLI
ord: 1
---
The operator starts a conversation with any agent the project offers: built-in `tagma` (the default type) and `rules`, agents from the personal, project, and plugin libraries, and `harness:<cli>` — Claude Code, Codex, Grok Build, Devin, Cursor, Gemini — when their CLI is found on the machine.

**How.** In the app — a new thread (`/new`) and the `/agent` type picker in the composer; on a thread that already runs, `/agent` opens a new thread of another type. The `create_thread` operation opens a root without the first turn or another thread's child with a task; operator, agents, and outside callers can call it. `list_thread_types` answers the offered types, the default type, and rejected agent files; for a CLI type the row carries the found binary, version, and why it is missing; `refresh` re-reads the login profile and searches for CLIs again. From the terminal: `tagma threads new --title`, `tagma threads types`, and `tagma ask --new --title "<name>" "<text>"` — the turn runs on the server, the command only streams the answer, `--detach` returns at once.

**What a root gets at birth.** The type — `type` or the `agent.default` setting. The model — from the agent definition, otherwise the operator's default model; `account` and `switches` can be named. The approval mode — `approvalMode`, otherwise the mode the type carries, otherwise `agent.approvalMode`. Delegation — its own `delegation` switch or inheritance. The place — `worktree` (`new` cuts a fresh worktree, with `base` and `worktreeName`), the graph block `scopeName`, a host (a prepared sandbox, `sandbox:<id>`).

**Limits and refusals.** An initial task (`task`) goes only to another thread's child or to a CLI root, otherwise `parent-required`. A child through `create_thread` inherits scope, model, authority, delegation, and worktree: any of these fields refuses with `child-inherits`. Unknown type — `unknown-type`, one that exists but is not offered — `type-withheld`. An agent with delegation off gets `delegation-off`. `base` or `worktreeName` without `worktree: new` — `base-without-new` / `name-without-new`. A host the server does not bind — `host-unknown`; an unraised host — `host-not-ready`, the thread stands meanwhile, and deleting it frees the host. In review mode `create_thread` asks the operator, as do the "mode not offered" and "thread in archive" conditions.

**Links.** Agent definitions and who they are offered to; the default model; approval modes; CLI threads.

Code: apps/tagma/server/src/threads/contract/wire/operations/routes.ts#ROUTE_OPERATIONS, apps/tagma/server/src/threads/birth/acts.ts, apps/tagma/server/src/threads/contract/wire/creation.ts#threadCreateSchema, apps/tagma/server/src/threads/contract/wire/settings.ts#defaultType, apps/tagma/app/src/lib/features/threads/native/commands/agent.commands.ts, apps/tagma/server/src/threads/cli/threadVerbs.ts, apps/tagma/server/src/threads/cli/turnVerbs.ts
