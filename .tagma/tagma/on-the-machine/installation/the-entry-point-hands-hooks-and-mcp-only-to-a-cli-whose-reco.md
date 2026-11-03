---
id: 01a1a2a4-8835-7cb7-a49a-3eed0f7f027d
title: The entry point hands hooks and MCP only to a CLI whose recorded server is proven to be the active one
ord: 80
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/installation/contract/wire/junction.ts
  - kind: file
    ref: apps/tagma/server/src/installation/setup/active.ts
---
`active.json` outlives its holder: a server with a process generation keeps it after releasing `active.lock`, so Stop can find the generation across the lock-free handover gap, and a killed holder leaves it behind. A live PID therefore proves nothing about the record; after a stop it may belong to any process. The shell script stays a cheap filter — `kill -0`, then exec the recorded CLI marked as entered — because it runs on every hook and must not depend on a platform tool. The current CLI decides: it serves an entered call only when the record names its own channel and the recorded process is the one that wrote it — the same kernel birth, or, for a record without birth, the PID holding `active.lock` open, read without taking the lock, since a probe that took it would make a server starting at that moment refuse `channel-active`. Otherwise a hook leaves quietly and every other verb says Tagma is not running. A CLI from an issued release named by an old record does not know the mark and still trusts the live PID.