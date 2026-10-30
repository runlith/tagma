---
id: 01a18348-a574-7e5b-97f3-9959a99bba00
title: "Text a model writes into a tool call or answer has no length ceiling: it is never refused or cut for its length"
ord: 20
tags: ["rule"]
sources:
  - kind: dir
    ref: packages/agent/src/collaboration
  - kind: dir
    ref: apps/tagma/server/src/threads/contract/wire/operations
  - kind: dir
    ref: apps/tagma/server/src/native-harness/tools
---
Covers messages, tasks, reports, questions, answer chips, words spoken to a CLI and a CLI harness's answer. The model's own output limit is the only bound. Identifiers, names and keys keep their bounds.