---
id: 01a18923-2cd4-71ca-abf6-1cc7ca37273b
title: submit_work refuses lines-held for a local variable whose name matches a peer's uncommitted member
ord: 155
tags: ["reflection"]
fields:
  {
    "actual": "refused[lines-held]: \"selected references require uncommitted declarations: scope in apps/tagma/server/src/mcp/contract/service/servers.ts:21, held by 01a18907-6553-743b-958a-94cb2bea6d57\", twice in a row",
    "command": "submit_work paths:[\"apps/tagma/server/src/mcp/serverPool.ts\"] tasks:[\"85cc8a79\"]",
    "expected": "Land the session's one line `const scope = yield* Scope.fork(yield* Effect.scope, 'parallel');`, which references no peer declaration"
  }
---
Filed from project `tagma`.

The session's line declares a local `const scope` inside `makeMcpServers` (it replaced `const scope = yield* Effect.scope;`), and every use of `scope` in that function refers to that local. The peer's uncommitted `scope` at `mcp/contract/service/servers.ts:21` is a member of an input type (`McpServerSeenInput`-like shape), reached in serverPool.ts only as `input.scope`/`entry.scope` on the peer's own lines. The member-name check pairs the identifier text with that declaration without a receiver, so an independent line in a file another session is editing cannot land until that session lands. The only exits offered are waiting for the peer or carrying its unfinished work.