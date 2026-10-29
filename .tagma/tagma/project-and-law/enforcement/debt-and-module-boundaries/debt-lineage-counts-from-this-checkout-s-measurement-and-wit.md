---
id: 01a10c48-d98c-7f81-a572-39bc5237b9e3
title: Debt lineage counts from this checkout's measurement, and without it — from the parent of the commit that last changed the rule file
ord: 1
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/enforcement/lineage.ts
    symbol: lineageFrom
---
Renames by which debt moves to a new fingerprint are read with `git diff --find-renames` from the point where the debt was recorded to HEAD.

- There is an own measurement — its commit is the point.
- None (fresh worktree, clone) — the first parent of the last commit that changed the rule file in `.tagma`. A document carrying this debt arrived in the tree no earlier than that commit, and the parent includes in range a rename that landed with the same commit as the debt.
- The graph doesn't lie in the checkout tree (the rule file is outside its git) — no point, no renames read.

A wider-than-needed range is harmless: a record moves only when the old fingerprint disappeared, a new one is found and free of another record; the record value becomes measured on the new path. A narrower-than-needed one is costly: a renamed file with debt reads as a new violation (`debt-grows` at `enforce_rule`, escape at remeasure). The choice boundary: editing the rule file itself after the rename (title, body) moves the point past the rename, and such a move isn't found until the first measurement in this checkout.

Rejected: a point at the commit where the `enforcement` field itself changed — it needs parsing the file history and doesn't pay for this rare case.
