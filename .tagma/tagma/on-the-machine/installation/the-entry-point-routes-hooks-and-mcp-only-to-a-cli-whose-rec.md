---
id: 01a1a2a4-8835-7cb7-a49a-3eed0f7f027d
title: The entry point routes hooks and MCP only to a CLI whose recorded process holds the active lock open
ord: 80
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/installation/contract/wire/junction.ts
---
`active.json` outlives its holder: a server with a process generation keeps it after releasing `active.lock`, so Stop can find the generation across the lock-free handover gap, and a killed holder leaves it behind. A live PID therefore proves nothing about the record; after a stop the PID may belong to any process. The entry script execs the recorded CLI only when that PID has `active.lock` open, read without taking the lock: a probe that took it would make a server starting at that moment refuse `channel-active`. Otherwise a hook leaves quietly and every other verb says Tagma is not running.