---
id: 01a13fce-a146-7f42-8015-220531b8a60c
title: "`modules` judges a bundler-query import (`?raw`, `?url`) by file, not as unresolved"
ord: 33
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13f95-99b8-7325-8d9a-d0a769566ef9",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13f95-60fe-7047-a344-e33f81074aa9
sources:
  - kind: file
    ref: apps/tagma/inspection/src/packs/architecture/modules/implementation.ts
---
A bundler-query import — `$lib/.../cursor.svg?raw`, `./icon.svg?url` — `modules` looks up as a path together with `?raw` and calls unresolved, though the file lies in the tree. Noticed on `apps/tagma/app/src/lib/features/threads` during a trial judgment with the generated-config copy: of 294 files three are unresolved — `$app/state` (virtual module, task 02328b95) and two `?raw`.

To do: query is a bundler variant, so the rule declares which suffixes are stripped before resolution (like `platforms` `leaves`), and the import is judged by the file without the suffix. Verification: a `modules` contract test where a `?raw` import of someone else's private file gives `private`, not `unresolved`.

The `queries` parameter landed in e3b9c09ed8, test red→green (relative and alias import). The running server predates the commit and refuses `queries` as an extra field (`body-shape`), so the declaration on the [[083d37f1|module rule]] waits for the operator's restart.

Old `modules`, `loads` and `platforms` documents are converted to the new shape by the graph step `platforms-declared` (dfb580e9c6) on the new server's first touch of the copy; no readability calls needed. When the step cannot keep the previous verdict on the project tree, it leaves the document as it was with an `unmigrated` field and a reason, and the rule answers "inspection cannot run" with that reason.

After restarting on a build no older than dfb580e9c6, only runlith additions remain, unneeded for readability:
1. `enforce_law(blockId: "083d37f1", base: <revision from read_inspections>, strictness: "gate", inspection: <parameters standing after the step + `framework` "./$types" + `queries` ["?raw"]>)`. Check: `read_inspections` shows both parameters and `runtimes: ["node", "bun"]` from the step, debt 0.
2. Trial judgment of `apps/tagma/app` with these parameters: not one unresolved.
