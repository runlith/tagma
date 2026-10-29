---
id: 01a14c14-a11c-7ce8-9d84-6323e8224d0b
title: Strict provenance requires an origin for every task — but only as a law line for foreign CLIs
ord: 1
tags: ["feature"]
fields:
  {
    "state": "partial"
  }
edges:
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-692e4ad9de5e
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-632bd215090b
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/inputs/walk.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/contract/wire/storage.ts
    symbol: PROJECT_SETTINGS
  - kind: symbol
    ref: apps/tagma/server/src/graph/orientation/law.ts
    symbol: lawReads
---
**Value.** An operator who cares about traceability wants every project task to lead to the spec it implements or the block where it was found.

**How.** The `--strict-provenance` flag of `tagma project add`, `tagma project set <project> strictProvenance true`, the `update_project` operation; a mark in `tagma project list`.

**Behaviour.** The policy adds one obligation to the managed law section (`read_law`, `tagma law`) that `tagma install` and `tagma upgrade` write into AGENTS.md.

**Limits.** This is only text for foreign CLIs reading AGENTS.md:
- the server doesn't check the policy — a task without an origin edge is born as usual;
- native Tagma agents don't receive the obligation: their instructions assemble without it, and they cut the managed section out of instruction files they read;
- a policy change doesn't rewrite AGENTS.md — the obligation appears or vanishes there only after `tagma install`, `tagma upgrade`, or `tagma law --write`.

The flag's CLI description ("every task here carries its origin") promises more than the code does.
