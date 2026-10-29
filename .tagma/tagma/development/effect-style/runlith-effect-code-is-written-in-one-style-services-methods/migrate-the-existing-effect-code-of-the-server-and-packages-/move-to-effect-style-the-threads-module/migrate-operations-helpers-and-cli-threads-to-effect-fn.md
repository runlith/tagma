---
id: 01a13f43-7f1c-7a21-9ede-1a81e58e7505
title: Migrate operations helpers and CLI threads to Effect.fn
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13dcf-d796-7317-8b62-3cac8ce5923e",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/cli/turnVerbs.ts
  - kind: file
    ref: apps/tagma/server/src/threads/operations/agents.test.ts
  - kind: file
    ref: apps/tagma/server/src/threads/operations/attention.ts
  - kind: file
    ref: apps/tagma/server/src/threads/operations/collaboration.ts
  - kind: file
    ref: apps/tagma/server/src/threads/operations/folders.ts
  - kind: file
    ref: apps/tagma/server/src/threads/operations/namedPages.ts
  - kind: file
    ref: apps/tagma/server/src/threads/operations/routes.ts
---
Replace the gen-wrapper in operations helpers and CLI with the effect4 shape, and migrate agentSource tests to effect-test. Keep action order and refusal channels; verify server types, agentSource tests, effect-style, diff and review. This is group 5's first delivery; the module's remaining parts stay in the parent task.
