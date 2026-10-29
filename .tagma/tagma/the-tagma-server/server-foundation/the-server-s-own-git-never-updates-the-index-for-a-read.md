---
id: 01a13226-8e5a-73e6-be68-99e2c81355de
title: The server's own git never updates the index for a read
ord: 11
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a1321c-2265-787f-bcd0-daa6156f2211
sources:
  - kind: symbol
    ref: apps/tagma/server/src/platform/git/ownGit.ts
    symbol: ownGitOptions
---
Commands with the server's own-git marker run with `GIT_OPTIONAL_LOCKS=0`: a background read never refreshes the index stat cache and never wakes checkouts' watchers with its own write. This covers dirty-file reads of the team graph as well; mandatory `add`, `update-index`, commit and merge writes stay ordinary git acts.
