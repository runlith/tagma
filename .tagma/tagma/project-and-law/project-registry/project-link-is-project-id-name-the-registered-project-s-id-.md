---
id: 01a1712f-b87b-73ef-8caf-e45bb98323a1
title: "Project link is `[[project:<id>|name]]`: the registered project's id and its name"
ord: 12
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/projects/contract/wire/references.ts
---
A block is named `[[name]]`, a thread `[[uuid]]`. A project needs its own prefixed form: its id is a short number that without a prefix would read as a block name.

The link carries the id, not the name. Every agent `project` field takes the id, and it does not change on rename. The name after `|` serves the person and the agent reading text without the interface — for example a CLI in the terminal. The id is local to the machine. That is acceptable because the link lives in thread messages, not in the stored graph that travels to colleagues.

Three owners know the form, and they change together:
- the agent — from the Answering section of its instructions;
- the feed and the operator message — through this wire;
- the composer draft — as a mention named `project:<id>`, which turn rollback returns as a chip.
