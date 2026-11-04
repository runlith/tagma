---
id: 01a1a76d-5fe7-72e5-be03-37bfae761dda
title: The ripgrep kit stops its child by an OS name every caller passes in as process.platform
ord: 5
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a0eaa1-2c4c-7cbd-9014-d7496f758080
  - kind: relates
    to: 01a19ec6-f467-787a-a87e-89cb77c57d56
sources:
  - kind: file
    ref: packages/ripgrep/src/run.ts
  - kind: file
    ref: packages/navigation/src/navigation.ts
  - kind: file
    ref: apps/tagma/server/src/checkout-files/search/content.ts
  - kind: file
    ref: apps/tagma/server/src/executions/commands/search.ts
  - kind: file
    ref: apps/tagma/server/src/composition/navigation.ts
---
A search run carries a `platform` string and the kit picks its stop ladder from it: the Windows kill-with-escalation or the POSIX INT, TERM, KILL ladder. Every caller fills the field with `process.platform`, so the OS name travels through four shared modules to one branch.

Read at ee24295b8e:
- `packages/ripgrep/src/run.ts:9` the run type carries `platform: string`; `:136-137` `ended` branches on `'win32'`; `:145`, `:169`, `:187` pass it on.
- `packages/navigation/src/navigation.ts:25,243` the navigation kit forwards `setup.platform` into the run.
- `apps/tagma/server/src/composition/navigation.ts:30` fills it with `process.platform`.
- `apps/tagma/server/src/checkout-files/search/content.ts:89` and `apps/tagma/server/src/executions/commands/search.ts:292` do the same.

Done when the kit asks its caller for a stop behaviour instead of an OS name, the OS-specific ladder is an adapter composition supplies, and the kit's tests pass on a Linux runner.