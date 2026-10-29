---
id: 01a14bae-6720-7d62-897a-9276efa7d836
title: Operator opens a thread as any agent offered to them — built-in, file-declared, or someone else's CLI
ord: 1
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-927fda029bcc
  - kind: relates
    to: 01a14bae-6720-7d62-897a-928acad90fdf
  - kind: relates
    to: 01a14bae-6720-7d62-897a-928bb2581edb
  - kind: relates
    to: 01a14bae-6720-7d62-897a-928db50ae262
  - kind: supersedes
    to: 01a14b6d-b1d3-7a33-98dd-a3bc712ced40
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/commands/agent.commands.ts
  - kind: file
    ref: apps/tagma/server/src/threads/birth/acts.ts
  - kind: file
    ref: apps/tagma/server/src/threads/cli/threadVerbs.ts
  - kind: file
    ref: apps/tagma/server/src/threads/cli/turnVerbs.ts
  - kind: symbol
    ref: apps/tagma/server/src/threads/contract/wire/creation.ts
    symbol: threadCreateSchema
  - kind: symbol
    ref: apps/tagma/server/src/threads/contract/wire/operations/routes.ts
    symbol: ROUTE_OPERATIONS
  - kind: symbol
    ref: apps/tagma/server/src/threads/contract/wire/settings.ts
    symbol: defaultType
---
**Value.** The operator needs no separate tool per agent: the built-in Tagma agent, a custom agent from a file, and someone else's CLI all open the same way, as threads in one list.

**How.** A new thread and the `/agent` command in the app, the `create_thread` operation, the `tagma threads new` and `tagma ask --new` CLIs.

**Behaviour.** A thread is born where it is told: in the current checkout, in a fresh worktree, under a graph block, or on a prepared sandbox. The model comes from the agent definition, otherwise the operator's default model; the approval mode from the type, otherwise the project setting. A CLI type is offered only when its CLI is found on the machine. A CLI thread without a model choice is born before provider login or directory load; the launch reports the needed login. A creation refusal from the "+" menu is shown next to that menu without changing the open chat's notification. A `tagma ask` turn runs on the server: the command only shows the answer, and a closed terminal does not cut the turn.

**Limits.** An initial task at birth goes only to another thread's child or to a root with someone else's CLI. A child created by the operation inherits the parent's scope, model, authority, delegation, and worktree, with no right to redefine them. A sandbox that never came up leaves the thread standing until deleted.
