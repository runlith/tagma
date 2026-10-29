---
id: 01a180c1-037f-7ac4-949d-94a7e33e6bd4
title: Commits in tagma follow Conventional Commits with the module id as scope
ord: 2
tags: ["rule"]
edges:
  - kind: relates
    to: 01a17f5f-3c8d-78c2-b6c7-2ab23bffa0a7
---
Type is `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `build`, `ci`, `chore` or `revert`, chosen honestly: a mechanical edit is not `feat`. Scope is the id on the card of the module the change was made for, without `@runlith/`; none for a change across the product. Subject: English, imperative, lowercase, no trailing period, at most 72 characters. The body says what changed in behaviour and why, in one to three sentences; a micro-edit may omit it. `!` and a `BREAKING CHANGE:` trailer only when the `@runlith/tagma` package, CLI commands or operation inputs break.