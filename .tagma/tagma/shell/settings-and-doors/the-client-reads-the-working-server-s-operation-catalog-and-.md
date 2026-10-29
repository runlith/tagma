---
id: 01a14c05-9e8f-7c75-a633-b2ac8ddf7b0e
title: The client reads the working server's operation catalog and notices its contract change
ord: 4
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2abc2918809
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/wire/Door.ts
  - kind: file
    ref: apps/tagma/server/src/cli/verbs/op.ts
  - kind: file
    ref: apps/tagma/server/src/invocation/contract/wire/operations.ts
  - kind: file
    ref: apps/tagma/server/src/invocation/readOperations.ts
  - kind: file
    ref: apps/tagma/server/src/invocation/registryEntries.ts
---
**Value.** A client or agent learns the server's executable contract from the product itself, without reading its sources.

**How.** The `read_operations` operation over HTTP or `tagma op`; `tagma op` itself enumerates the local catalog, and help unfolds the chosen record with the JSON Schema of its input.

**Behaviour.** The server catalog gives the meaning, input shape, available doors, callers and approval conditions. Selection narrows by operation names and reads in pages. The whole catalog's fingerprint accompanies HTTP answers: a client can spot a contract change, and the window a need to update its build.

**Limits.** The catalog describes operations, not every extra runtime tool. Presence in the catalog does not mean offered to an agent: native and MCP only get their capability-declared tools. The CLI's short list refers to its own build; the working server's current contract is given by `read_operations`.
