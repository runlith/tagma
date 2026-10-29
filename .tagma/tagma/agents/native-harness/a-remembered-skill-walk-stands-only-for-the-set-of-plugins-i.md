---
id: 01a18919-ce13-775e-b899-80a72b04abc7
title: A remembered skill walk stands only for the set of plugins it was walked with
ord: 64
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a14c08-8335-7c28-8f6b-267b0bb6f81f
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/inputs/cache.ts
---
Under `skills.rescan` `manual` or `session-start` a walk is remembered per project and tree, yet disabling a plugin must withdraw its skills and commands at once. Every read therefore asks `EnabledPlugins.of` first and reuses the remembered walk only if the enabled plugins' ids, roots and skill and command names match the ones it was walked with; otherwise it walks again. Keying on the answer, not on the `changes` stream, makes the withdrawal hold at the very next read, with no race against a subscriber dropping the walk. A run keeps the sources bound to it until it ends, like any other source change.