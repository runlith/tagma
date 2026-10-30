---
id: 01a1258f-3b5e-7d41-9da9-4c611659016b
title: "Post-landing index pickup preserves only staged changes: an entry equal to the landing's base is always brought to the commit"
ord: 1
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a12582-fbf7-755e-8fd0-98c0a4db449b
sources:
  - kind: file
    ref: apps/tagma/server/src/landing/land/indexSync.ts
---
The protection over colleagues' texts (`peers`) exists so another's `git add` of their own version survives, and such an entry differs from the base by definition. For an ordinary landing, an entry equal to the base (the published commit's parent; an earlier landing attempt's base does not count here — relative to HEAD such an entry is staging itself) carries no staging, and comparing it against colleagues' texts is wrong: a colleague's line stays `held` for hours after its text landed, and its afterHash matches the HEAD text. Without this rule the index stayed on the pre-commit version, and every next landing saw index ≠ base and also left it alone — in the Git window it looked like a staged rollback of others' work. The decision and any replacement hold git's real `index.lock`, so an accepted external staging cannot be overwritten between them; an unchanged index is never copied.
