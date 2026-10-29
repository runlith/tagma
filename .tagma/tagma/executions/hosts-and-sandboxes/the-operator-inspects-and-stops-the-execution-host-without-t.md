---
id: 01a14c14-6895-75c6-80f2-47ca819c7fba
title: The operator inspects and stops the execution host without the server, with the tagma execution-host command
ord: 10
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/cli/host.ts
---
**Value.** If the server does not come up or answer, the operator still sees what the host holds and can finish an execution or the host itself.

**How.** CLI `tagma execution-host` with `status`, `list`, `operation`, `stop`, `shutdown`, `fence` subcommands.

**Behaviour.**
- `status` names the host build and what it holds; `list` pages its executions.
- `stop`, `shutdown`, and `fence` are durable acts under a key the operator names: repeating the same command continues the interrupted act instead of starting a second one; `operation` reads the key's outcome.
- `shutdown` reports on each execution it found; an unfinished shutdown keeps the key.
- `fence` drops a non-answering keeper over the read revision and issues nothing.

**Limits.** Without an explicit choice the command works with the single standing host of the installation; another is named by environment or state directory.
