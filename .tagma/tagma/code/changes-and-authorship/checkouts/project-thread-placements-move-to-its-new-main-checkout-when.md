---
id: 01a179c5-d801-788f-a0e9-12d93d7b1218
title: Project thread placements move to its new main checkout when it becomes a different directory; the directory rootId does not move along
ord: 25
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/drizzle/20261026200000_main_placements/migration.sql
  - kind: symbol
    ref: apps/tagma/server/src/workspace/roots/coverage.ts
    symbol: makeCoverageLedger
  - kind: symbol
    ref: apps/tagma/server/src/workspace/store/assignments.ts
    symbol: makeAssignmentStore
---
`rootId` names a directory by witness (inode and birth time), and everyone who registered the same directory shares one registration: project coverage, install-source watching, an adopted root. So when the project's main root changes to a different directory (`set_project_root` onto a fresh clone or another repository), the `rootId` of the former main checkout does not move along: it would drag someone else's watches and change-record line entries that physically belong to the old directory. A directory moved with `mv` keeps its witness, and its `rootId` stays the same with no move.

The role moves. The coverage act that sets the new main root moves, in the same write unit, the project's own threads' selection and memberships from the former main root to the new one and bumps the selection revision: the former main checkout meant "the project's main checkout" to them. Without this, after a root change threads stayed on the old `rootId`, the worktree list showed them as "elsewhere", and the window held a checkout the project no longer has. Other projects' threads and placements in worktrees of the former repository are untouched: they name those directories themselves. If someone holds the new main checkout and it is not publishing, coverage keeps the project's former main root and former root stamp: the move is not lost, and every coverage read until the hold lifts answers `moved` and retakes coverage.

State left from past root changes is repaired once by the `20261026200000_main_placements` migration, keyed on "the main tree of a repository registered for the project that the project no longer covers". A former folder-project root without git is not recognized by that key.
