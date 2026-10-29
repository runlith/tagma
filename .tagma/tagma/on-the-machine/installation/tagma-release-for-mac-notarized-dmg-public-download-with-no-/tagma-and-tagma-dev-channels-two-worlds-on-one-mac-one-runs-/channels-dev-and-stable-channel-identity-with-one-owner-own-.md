---
id: 01a13666-b6da-7591-af1f-ec1e8010753b
title: "Channels dev and stable: channel identity with one owner, own data directory and port, checkout lease, hooks to the holder, move, operator migration"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13666-f127-704b-851a-41a618fe28f9",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13666-7072-79da-a7f4-bce12fbc8082
sources:
  - kind: file
    ref: apps/tagma/server/src/installation/contract/wire/layout.ts
---
Implement the spec whole. Start with channel identity: one concept at the install module, declared by composition, and translate every current place to it (`DATA_DIRECTORY`, `DEFAULT_PORT`, `APPLICATIONS`, launcher, window), then an inventory of everything the server, host and window write outside the data directory; then checkout lease with the work-places owner, hooks, move, operator migration. Module boundaries — through `set_module`; layer and port splits — per [[e090f46d]], [[6f758080]], [[51c66cb6]]. The operator's server never restarts: migration is proven on a copy of his `~/.tagma`, and the operator walks it himself with his own `tagma build`.

Done: everything in the spec's "What the implementer proves".
