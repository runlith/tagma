---
id: 01a126f1-0c2e-701a-af52-1f91f4f62e0f
title: The migration check tells apart vanished keys, written references and unchanged defaults
ord: 5
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a126b9-6a5d-780b-8049-421edbf2cadc
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/store/keyCheck.ts
  - kind: file
    ref: apps/tagma/server/src/platform/store/writes.ts
---
Foreign keys stay off for the DDL duration, so an intermediate schema may diverge from the data; FK actions therefore do not count as migration consequences, while SQL triggers do. Capturing keys before the parent write tells a new reference loss apart from a former dangling reference in the child. Comparison must apply the parent's affinity and collation: a unary `+` on the child column removes its own affinity. For a new ordinary FK column that later SQL never wrote, checking one row's synthesized SQLite default value and a present parent is enough; a generated column requires checking its values. Restore keeps full control of restored tables and the child's former full fallback when captured keys cannot be matched.
