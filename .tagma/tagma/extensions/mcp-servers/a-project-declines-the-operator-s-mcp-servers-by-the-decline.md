---
id: 01a188b5-6987-762e-bd02-4b55cba82897
title: A project declines the operator's MCP servers by the declined flag alone, and editing its own servers keeps the decline
ord: 14
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/settings/writes.ts
  - kind: file
    ref: apps/tagma/server/src/mcp/serverPool.ts
---
`mcp.servers` is written whole by no door: its servers change one at a time through `add_mcp_server` and `remove_mcp_server`, which go through `Settings.amend`. So its managed writer (`decline` in the pool) answers `write_setting_layer` only for `declined` alone in project scope, refuses any value `setting-managed`, and writes with `kept`, which keeps the row's stored value byte for byte — unreadable members included — and changes only the flag. `amend` keeps the flag the row already holds: writing `false` there would silently give a declining project the operator's servers back the moment it declared one of its own.

The writer commits first and then settles that project's pool, if one is open, awaiting its handshakes; a pool that cannot settle answers `setting-unapplied`: the decline is stored, and the next thread turn reconciles again. A declined user server stays in `read_mcp_servers` as status `declined` with no state of its own, while the pool, the secret holders and views never see it.