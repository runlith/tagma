---
id: 01a14c14-6895-75c6-80f2-47c0788868e6
title: Where a checkout thread's commands run — on the execution host or directly in the server process — the agent.checkoutWorld setting decides
ord: 9
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47c6411e9f4e
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47c97b9b56cc
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/worlds/managed.ts
  - kind: file
    ref: packages/agent-tools/src/bash/local.ts
  - kind: symbol
    ref: apps/tagma/server/src/native-harness/contract/wire/settings.ts
    symbol: checkoutWorld
---
**Value.** By default agents' commands are managed — visible, term-limited, surviving the server; the operator can opt out if the host gets in the way.

**How.** The user setting `agent.checkoutWorld`: Managed (default) or Platform.

**Behaviour.**
- Managed: where the host stands and offers commands, the thread's commands are its executions in the inventory. Where the host is not installed or did not answer, the thread works in the platform world, and this is written to the log. A failed managed execution does not fall back to the platform.
- Platform: the server process runs the commands on its own machine; they last only the call and do not reach the inventory.
- The choice is made when the thread's world opens.

**Limits.** This covers checkout threads: a sandbox thread always works in the guest. Terminals need the host under any value.
