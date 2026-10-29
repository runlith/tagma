---
id: 01a16174-819b-7e84-ba84-76bba2bfd956
title: False platforms findings on macro-import until a remeasure with the new builtin
ord: 3
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a16152-c605-7a6c-848d-1fb17bd07b34
  - kind: relates
    to: 01a1616b-3aa2-7f94-83cc-f88d05517689
---
The Bun macro-import phase is fixed in `cc9000b3c8` by the [[05517689|code-facts work]]. The executable builtin still counts a compile-time dependency as a runtime compiler load from `packages/tagma/kit/declarations.ts`, so the two false causes stay as temporary debt. The document kept a fingerprint pair for the final `kit` path and the old `src` path that is no longer in code. A remeasure with the new builtin must drop these records; the code macro-phase fix is done.
