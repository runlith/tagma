---
id: 01a19943-1ab6-72a2-bcb1-1169f3b1a676
title: A group member's skills are walked per member and composed into the home catalog at every read
ord: 70
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a14c08-8335-7c28-8f6b-267b0bb6f81f
  - kind: relates
    to: 01a18d86-3376-7adb-aa00-abfaf88b843f
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/inputs/cache.ts
  - kind: symbol
    ref: apps/tagma/server/src/native-harness/inputs/walk.ts
    symbol: readMemberSkills
  - kind: symbol
    ref: apps/tagma/server/src/native-harness/inputs/walk.ts
    symbol: withMembers
---
A group member's catalog reads every other member's project skill directories, each from that member's main checkout. Those walks are remembered apart from the home walk, keyed by the member and its root, and the catalog is composed from the current `ProjectGroups.of` answer at every read. A remembered composite would go stale on three events it cannot see — a project joining or leaving, a member's Re-read, a member's files changing under `manual` — and dropping it would need every member's invalidation to know every group it stands in. Composing at read, joining and leaving take effect at the next read under every `skills.rescan`, and `invalidate` for one project drops only that project's own walks. Composition is a projection over a few dozen entries; the walks are what cost.

A member's walk is independent of the home's settings: it takes the member's own `skills.directories.project`, because they describe that repository, and marks Tagma's own skill rather than dropping it. The home's `skills.project.enabled` and `skills.own.enabled` are applied when composing, so one remembered member walk serves every other member's threads. Naming between members belongs to the skill pool, which alone knows the built-in names a member skill must not take.
