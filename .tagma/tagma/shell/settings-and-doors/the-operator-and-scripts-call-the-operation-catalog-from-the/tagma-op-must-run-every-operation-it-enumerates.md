---
id: 01a14c37-8e52-7833-9532-fa0dd76d20ab
title: tagma op must run every operation it enumerates
ord: 1
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a14c05-9e8f-7c75-a633-b2ae2265adc4
sources:
  - kind: file
    ref: apps/tagma/server/src/cli/verbs/op.ts
  - kind: file
    ref: apps/tagma/server/src/composition/http/operations.ts
---
`tagma op` enumerates the whole catalog but calls over HTTP, and socket-only operations refuse (`channelRefusal`). Either call them by their door or do not enumerate them as callable.
