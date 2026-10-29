---
id: 01a16611-c34a-72c7-abd3-2af6dbe7d8e7
title: "\"A new machine-state response field arrives optional: the new CLI reads the still-running old server\""
ord: 8
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/installation/cli/server.ts
  - kind: file
    ref: apps/tagma/server/src/installation/contract/wire/next.ts
---
`tagma release update --no-restart` switches `current` to the new release without touching the running server, and the following commands already go through the new CLI. `tagma restart`, `release update/back` and `status` first read `read_machine_state` from the old server and decode the whole answer with the new version's schema. If a field in that answer changed shape or became required, decoding fails, and a user who postponed the restart cannot restart with the standard command.

So an existing field keeps its shape, and a new one arrives beside it as optional. That is how `NextStanding.behindBy` — the number for `↓N` in the status bar — stands next to the `behind` words instead of replacing them.
