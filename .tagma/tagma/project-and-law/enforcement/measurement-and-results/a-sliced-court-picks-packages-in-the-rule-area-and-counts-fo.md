---
id: 01a132d4-764e-7e17-af1b-8f579a3efba1
title: A sliced court picks packages in the rule area, and counts foreign dependencies via frontier
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/judging/check.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/judging/judge.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/programs/bindings.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/workers/asks.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/workers/slicing.ts
---
The area comes from the law, not from the changed-path list: a package crossing the reach is judged whole, and the frontier is needed to compute its result through other packages. Independent starts outside the area don't become this rule's subject. One reach passes through the landing court, check_rules and composite bindings; otherwise a scoped rule would judge the whole workspace again even when a single foreign path changed.
