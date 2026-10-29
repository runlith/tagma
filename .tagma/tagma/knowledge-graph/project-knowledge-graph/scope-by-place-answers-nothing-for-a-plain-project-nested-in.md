---
id: 01a0cab3-b821-7f7c-9e91-8f8ed8ed42f3
title: Scope by place answers nothing for a plain project nested inside a git repository
ord: 218
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/serving/scope.ts
    symbol: graphScopes
---
`relativePlace` asks the repository first: where the cwd falls inside any repository it answers by key match and never falls through to textual containment. A plain project nested inside a git repository — reachable by registering the folder, then initing git inside it — therefore resolves no place for a cwd textually inside its root, and scope narrowing answers nothing. The containment below the repository arm is dead for every cwd git can place.

Done when a cwd inside the root but outside the project's own repository falls through to containment, or the code states that a project nested in foreign git resolves no place — proved by a test registering plain, then initing git beneath the root.