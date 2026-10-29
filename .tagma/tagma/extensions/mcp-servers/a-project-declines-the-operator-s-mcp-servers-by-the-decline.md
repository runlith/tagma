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
`mcp.servers` is written whole by no door: its servers change one at a time through `add_mcp_server` and `remove_mcp_server`, which go through `Settings.amend`. So its managed writer (`decline` in the pool) answers `write_setting_layer` only for an explicitly given `declined` alone in project scope — `declinedGiven` tells it from an omitted flag, so a clear through `write_setting` is refused rather than read as `declined: false` — refuses any value `setting-managed`, and writes with `kept`, which keeps the row's stored value byte for byte, unreadable members included, and changes only the flag. `amend` keeps the flag the row already holds: writing `false` there would silently give a declining project the operator's servers back the moment it declared one of its own.

The writer commits and publishes the rows first, then settles the project's pool under the same permit its other passes take, if a pool stands by then: a pass that was opening the pool from declarations read before the commit is followed by one reading the decline. A pool that cannot settle answers `setting-unapplied` — the decline is stored, the next thread turn reconciles again — and the app's settings catalog reloads on that code, since the value it shows did change. A declined user server stays in `read_mcp_servers` as status `declined` with no state of its own, while the pool, the secret holders and views never see it.