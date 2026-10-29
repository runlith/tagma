---
id: 01a16e48-152e-7470-8f62-6ef9279e6737
title: The CLI builds its HTTP client from only the API groups the running verb needs
ord: 29
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16ded-dc3b-7bb7-abeb-578f9f565e34",
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a16e37-8d17-7b78-bc1a-de5bc4fdb83b
  - kind: implements
    to: 01a16ac4-44bf-7e0a-8178-b6ff38ef1770
---
After [[c4fdb83b]], `tagma check --gate` loads 452 modules, ~150 of them non-effect pulled in by the CLI door client: `composition/cli/door.ts` builds the `HttpApiClient` from the whole `http/contract/wire/Api.ts` (health, operations, threads, checkouts, speech with their modules' schemas). Goal: a client from only the API groups the running verb uses — same verbs, same wire, same refusals; modules loaded and CPU of `tagma check --gate` measured before and after. That cheapens every git-hook commit gate and every test that starts the CLI.

**Not done: the measurement refuted the premise.** The prototype — an `OperationsApi` (health + operations with the same middleware, full `Api` through `addHttpApi`) and a second CLI door for `check`, `hook`, `harness-run` — cut `tagma check --gate` from 452 to 448 modules: the threads, checkouts, and speech groups are 4 light wire files. The remaining ~140 non-effect modules are used by `check` itself (operation and enforcement finding catalogs, refusals, installation leases catalog, inspections catalog), plus ~306 of effect itself. A second door for the sake of 4 modules is more complex than what it saves; the prototype was rolled back, never committed.
