---
id: 01a113d9-081f-739e-a5b9-688c29e06d3d
title: Thread renaming — an agent tool and an app action under one declaration; no root limits, a foreign thread outside the subtree needs the operator's word
ord: 5
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/operations/acts.ts
  - kind: file
    ref: apps/tagma/server/src/threads/turns/adjustments.ts
---
`set_thread_title` is declared next to `archive_thread` and `generate_thread_title` in `threads/contract/wire/operations/catalog.ts` and executes in `threads/operations/acts.ts`; the app calls the same operation over HTTP, there is no second declaration.

Renaming is not root-limited: `ThreadAdjustments.setTitle` writes the title of any project thread with `manual` origin, which autonaming does not replace. Only `generate_thread_title` is root-limited (`not-a-root` in `naming/generate.ts`): a spawned thread's list row carries its team's address.

An agent whose call touches a thread outside its own subtree gets `outside-subtree` consent via `strangerConsents`, like `set_thread_operator_notice` and `move_thread`; its own thread and its subtree's threads rename without a question. A title empty after trim refuses `title-empty`.
