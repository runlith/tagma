---
id: 01a12763-94e8-769e-bdaf-2946b9d7917c
title: "Place policy for a resource behind a symlink: write/edit and a command cwd are judged by the link target project, not the checkout holding the link"
ord: 8
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1276b-5dd5-7b21-9465-335588d773aa",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1273c-99cc-734f-a6ae-b0edd1e7ac82
sources:
  - kind: file
    ref: apps/tagma/server/src/workspace/checkouts/paths.ts
  - kind: file
    ref: apps/tagma/server/src/workspace/governing.ts
---
`CheckoutPaths.placeAcross` deliberately does not follow the final symlink component (the write place is the directory record itself). Place policy (`workspace/governing.ts`, `executions/commands/access.ts` `ruledAt`) takes that answer, while write/edit write the canonical target (`packages/files` replace) and a command with a `workdir` link runs in the target. Example: `A/a.ts → B/a.ts` — A's comment policy when writing into B; `A/link → B` as `workdir` — A's command rules with cwd in B; a link outside every checkout to B — fallback to home.

Do: `CheckoutPaths` returns the addressed (dereferenced) resource's place alongside the directory-record place; dereferencing acts (write/edit, cwd, comment policy, command rules) take the first, rename/delete the second. Align with line accounting (`change-record` Intake also places the line by `placeAcross`) so one act's policy and line name one place.

Done: an integration test with two projects — a write through an A→B link is judged by B's comment policy; a command with a `workdir` link to B runs under B's command rule.
