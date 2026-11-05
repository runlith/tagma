---
id: 01a1ad3a-f940-7727-920c-1581a3d3b323
title: A new migration that renames, drops or rewrites what the build before reads carries a back.sql that returns it
ord: 8
tags: ["rule"]
sources:
  - kind: dir
    ref: apps/tagma/server/drizzle
  - kind: dir
    ref: packages/activity/drizzle
  - kind: dir
    ref: packages/execution-host/drizzle
  - kind: dir
    ref: packages/performance/drizzle
---
`back.sql` stands beside the migration's `migration.sql` and holds the statements that bring the data back to the shape the build before reads; a step back runs it before reshaping the store onto that build's chain. Added tables, columns and indexes need none, nor a table rebuilt through a copy renamed into its place. Where nothing can be brought back, `back.sql` says so in a comment.
