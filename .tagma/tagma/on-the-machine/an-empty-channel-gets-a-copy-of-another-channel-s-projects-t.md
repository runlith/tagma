---
id: 01a14c05-71a7-71c8-88a1-ee4fd8a24944
title: An empty channel gets a copy of another channel's projects, threads and graphs
ord: 22
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: file
    ref: apps/tagma/desktop/src/SurfaceLoader.ts
  - kind: file
    ref: apps/tagma/server/src/installation/cli/transfer.ts
  - kind: file
    ref: apps/tagma/server/src/installation/move/transfer.ts
---
**Value.** An empty channel starts working with another channel's already accumulated projects, threads and graphs without losing the source.

**How.** A transfer offer at the window's first start; `tagma transfer --from`.

**Behaviour.** Transfer copies the database and owner-declared files, re-points saved addresses to the new places, and leaves the source world unchanged. It checks that the target world is empty and both servers have released the data, and that its program understands the source's migrations. An unfinished transfer is marked; a repeat completes exactly that fill.

**Limits.** Two existing worlds do not merge. This is local copying between channels, not a move to another machine and not cloud sync. Parts not transferred are reported by owner and are not passed off as full success; the CLI finishes such an outcome as an unfinished transfer.
