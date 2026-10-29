---
id: 01a12c8e-437a-7047-a57c-77144a51d1b9
title: Command-read authority is bound to admission, and checkout release preserves it
ord: 4
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a12c87-3ce1-77a1-b29c-cb5e536ffde9
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/commands/access.ts
  - kind: file
    ref: apps/tagma/server/src/executions/contract/service/access.ts
---
Observe and Await keep a stable projection of the admission plus a separate targetKey; temporary holdings are released when the command ends normally. Recheck keeps judging actor, provenance, custody, ancestry and policy. Binding the permission to rootUse would let cleanup itself turn an already-authorized read stale between stdout and stderr.
