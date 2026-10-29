---
id: 01a18483-7de5-772c-a5b3-a16343f37c54
title: "Tag words accept the displayed #name and the bare name"
ord: 245
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/contract/wire/fields.ts
  - kind: file
    ref: apps/tagma/server/src/graph/contract/wire/operations/history.ts
  - kind: file
    ref: apps/tagma/server/src/graph/contract/wire/operations/reads.ts
  - kind: file
    ref: apps/tagma/server/src/graph/contract/wire/query.ts
  - kind: file
    ref: apps/tagma/server/src/graph/contract/wire/tags/selector.ts
---
The vocabulary shown to agents uses a display sigil; the shared input grammar accepts that spelling before identity resolution so writes and selectors agree with the instructions their callers read. Stored tag ids stay bare, and an undeclared word still reaches the vocabulary's refusal.