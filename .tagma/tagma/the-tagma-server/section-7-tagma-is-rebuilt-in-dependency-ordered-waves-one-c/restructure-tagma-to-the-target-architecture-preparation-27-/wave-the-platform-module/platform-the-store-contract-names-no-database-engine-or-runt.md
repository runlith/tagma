---
id: 01a0eab2-bb99-70d7-94c3-eb6d8223746a
title: "platform: the store contract names no database engine or runtime — SQLite-on-Bun, git and flock move into platform's technology packs behind the contract"
ord: 7
tags: ["task"]
fields:
  {
    "status": "closed"
  }
---
`platform/contract/service/store.ts:5,15` defines `StoreDb = EffectSQLiteBunDatabase`, and the floor contract imports Drizzle, SQLite and Bun types (`:3-5`), so every module's store port is bound to SQLite on Bun. The floor module itself also holds `platform/git/*`, `platform/store/open.ts:1-9` (Drizzle, bun-sqlite, `BunFileSystem`, `node:fs`) and `platform/lock/flock.ts` (`bun:ffi`). Rule 6f758080 requires a core that names no technology, with packs beside it.

Target:
- The contract exposes what modules need: typed queries, units and snapshots, without the engine type.
- The SQLite-on-Bun implementation, the git kit and the file lock sit in platform packs that composition binds.
- The file lock is unified with llm's (llm-vendors agent, item 4).
- The contract's store brand holds without the `machineGraphStore` cast (`open.ts:212`).

This touches every module's store. Schedule it after the module waves close, as one cut with a Muse review pack (contract, migration, performance). Found by the architecture audit, 2026-09-29.