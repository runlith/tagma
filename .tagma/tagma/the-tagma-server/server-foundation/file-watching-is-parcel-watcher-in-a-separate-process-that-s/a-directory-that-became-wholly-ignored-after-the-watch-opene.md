---
id: 01a14c8b-8829-7733-8275-542c99e34f63
title: A directory that became wholly ignored after the watch opened (the first node_modules in a fresh worktree) leaves the subscription without waiting on an ignore recount
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c68-ea98-7334-8861-317dd11a1f05",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14c68-75fc-7268-bf0d-39b2d620c9b9
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/watch/tree.ts
---
A directory that became wholly ignored after the watch opened (the first `node_modules` in a fresh worktree) is excluded from the subscription without waiting on an ignore recount. A checkout tree's exclusions read with `git ls-files --others --ignored --exclude-standard --directory` at open and on `ignore`/`.gitignore` movement (`platform/watch/tree.ts#watchTree`). A directory that did not exist at read time is not in the list: the first `bun install` in a fresh worktree pours thousands of named paths into the server, and the checkout read goes full — exactly what the spec's acceptance 5 closes for an existing `node_modules`.

Direction: the watch process knows a created path is a directory (lstat in the process, not on the server); the platform asks `git check-ignore` only about created directories outside exclusions and reopens the subscription when a directory is ignored. Proof: `bun install` in a worktree with no `node_modules` gives no more than one full read (`CheckoutStatus.reading` spans).
