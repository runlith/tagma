---
id: 01a12384-d893-74ea-b875-2c5793ceba06
title: tagma:try prints the 409 project registration and starts the server as a detached process instead of a managed terminal
ord: 14
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12384-ecd5-7984-bc6c-726b16967c96",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12306-efba-7a0e-94d7-05f05ced9ad0
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/cut/try.ts
  - kind: file
    ref: apps/tagma/server/src/composition/server.ts
  - kind: file
    ref: apps/tagma/server/src/cut/try.ts
  - kind: file
    ref: packages/sqlite-process/src/child.ts
  - kind: file
    ref: packages/sqlite-process/src/lifetime.darwin.linux.itest.ts
  - kind: file
    ref: packages/sqlite-process/src/ProcessPool.ts
---
Poker acceptance: `bun run tagma:try --root ~/.tagma-poker --port 5953` prints the project-registration error (HTTP 409) and takes the server into a detached process, which the agent sees in no terminal and stops only with `tagma:try --stop`. Done when a repeat run on an already registered root prints no error, and a run from `start_terminal` keeps the original server in that terminal until it stops with a regular storage close on SIGHUP. Per the agreed boundary, preserving supervision across subsequent Succession process changes is a separate [[2d90b3af|server-successor task]].
