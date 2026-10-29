---
id: 01a0e532-cb9a-7319-9f40-e85e11f1e38f
title: "executions N: narrowed"
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e841-ca11-7a40-8e66-55d3d1aba29c",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0e470-ffc4-7261-8631-2ffbf7e0b9dd
  - kind: waits-on
    to: 01a0e532-c83e-75dc-a3c4-533ae1411479
  - kind: waits-on
    to: 01a0e532-c9fd-7bd4-a50c-bd345b1c2c01
  - kind: waits-on
    to: 01a0e532-ca7c-7f96-97dd-247ba9fd89de
  - kind: waits-on
    to: 01a0e532-cac4-7f8e-8f52-7d4845779ef0
  - kind: waits-on
    to: 01a0e532-cb92-7c35-bf59-cd3f79da54c4
  - kind: waits-on
    to: 01a0e532-cbac-7455-9a87-da05e51a3802
  - kind: waits-on
    to: 01a0e532-cbd9-7e00-b892-f4910015c354
  - kind: waits-on
    to: 01a0e532-cbfc-7817-83e6-7d22191594cc
  - kind: waits-on
    to: 01a0e532-cc21-7162-9c3e-d9aee2b6e4ec
  - kind: waits-on
    to: 01a0e532-cc47-7a95-b76f-fa121c7f76bf
  - kind: waits-on
    to: 01a0e532-cc6c-73df-a111-c28429ce4645
  - kind: waits-on
    to: 01a0e532-ccc1-799b-82bd-bde34047bdcd
  - kind: waits-on
    to: 01a0e532-cd22-7f1c-8fcf-c0b636bb8530
  - kind: waits-on
    to: 01a0e532-cd48-7c09-999e-8e0c98746485
  - kind: waits-on
    to: 01a0e532-cd6e-7a04-85b9-0ab5dd5ad950
  - kind: waits-on
    to: 01a0e532-cd97-7aa9-871a-73f6f2efd51b
  - kind: waits-on
    to: 01a0e532-cf0f-7514-a91c-221fa544b85f
  - kind: waits-on
    to: 01a0e532-cf39-790b-91f0-e6587139e341
---
§7.2.2 milestone `N` of the `executions` card ([[f7e0b9dd]]), with its vocabulary amendment [[08edfbc5]]. M3 retains the in-memory `TerminalActor` compatibility shape; in N, migrate its owner and every producer/consumer to platform `ActorRef` (including tagged literals in fixtures) in one mechanical change and one commit, then remove the old shape and conversion helpers. Do not leave a partially migrated shared tree.

HTTP route debt (from http M2 [[dd5ad950]]): executions owes answer schemas on every terminal, command and command-rule operation the `terminals.*`, `commands.*` and `commandRules.*` routes perform, and operations for the routes that perform none (terminal input, lane open/close, take-over, host standing, host replace, command feed) — or names them retained view-lane transports; each converted route then retires into `http/retired.ts`.