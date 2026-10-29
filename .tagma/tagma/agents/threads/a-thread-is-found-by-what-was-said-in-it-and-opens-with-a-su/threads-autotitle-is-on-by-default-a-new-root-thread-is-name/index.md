---
id: 01a0ff2b-54ff-7f7f-91d2-8f552a2eb46e
title: "`threads.autoTitle` is on by default: a new root thread is named automatically"
ord: 4
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: symbol
    ref: apps/tagma/server/src/threads/contract/wire/settings.ts
    symbol: autoTitle
---
Today the `threads.autoTitle` fallback is `false` (`threads/contract/wire/settings.ts`): 20 of 38 root threads from 2026-10-01…02 have random names.

The mechanism already exists: an aside on the operator's replica (`threads/naming/generate.ts`), 2–4 words, once; a manual name is untouched. Only the default changes — to `true`. The name stays stable: recap does not rewrite it.

## Acceptance

- A new root thread with no manual name receives a generated name after the operator's first substantive replica.
- A randomly named thread is named on the operator's next replica.
