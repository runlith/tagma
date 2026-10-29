---
id: 01a16aff-9b7d-7228-ba5b-5d2b0c2de9a6
title: "Fix two red server unit tests on HEAD: handles.test.ts and places.test.ts"
ord: 8
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16aff-dda6-7c61-ad99-8614b410a50e",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16ac4-44bf-7e0a-8178-b6ff38ef1770
---
`composition/handles.test.ts`: `search_output` does not print the `matches[].offset` and `searched[].through` handles. `composition/places.test.ts`: `merge_worktree`, `check_demo`, `walk_demo`, `build_demo` and `preview_demo` have no mandatory subject naming one project, and they do not accept `project`. Both failures deterministic on 2026-10-23.
