---
id: 01a14bae-6720-7d62-897a-929026c9986a
title: Agent CLI launched by the operator in the Tagma terminal becomes a project thread
ord: 8
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: supersedes
    to: 01a14b6d-b25d-76ba-b814-5e4049b97a6b
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/adoption/shellJob.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/contract/wire/hooks.ts
  - kind: symbol
    ref: apps/tagma/server/src/external-harnesses/adoption/adopt.ts
    symbol: makeAdoption
---
**Value.** A CLI the operator launched by hand in the Tagma terminal does not stay off the books: it becomes a project thread with its law and tools.

**How.** On its own: the CLI's hook asks the server to adopt the session.

**Behaviour.** The server adopts a session only after proving the CLI runs under its own operator terminal, not under another thread's terminal; the thread joins the project containing the CLI's working directory.

**Limits.** A CLI without Tagma hooks is not adopted. An unproven session ends without stopping the CLI.
