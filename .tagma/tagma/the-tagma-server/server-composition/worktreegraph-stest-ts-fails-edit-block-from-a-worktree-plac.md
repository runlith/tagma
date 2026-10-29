---
id: 01a10b25-fe2b-7741-9783-0e561c96d101
title: "worktreeGraph.stest.ts fails: edit_block from a worktree-placed thread leaves the claim untouched"
ord: 3
tags: ["task"]
fields:
  {
    "status": "open"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/http/worktreeGraph.stest.ts
---
On `5c2baedab2` (with the merge-court fix that does not touch this path) `bun test ./src/composition/testing/http/worktreeGraph.stest.ts` fails at line 134: after a scripted `edit_block` call (`unchecked` → `checked`) from a thread in a worktree, `read_block` with the worktree `cwd` answers `unchecked`. The thread does receive the worktree law (lines 131–132 pass). Start from what `edit_block` answered in the second turn (`told[1]`), and from the recent `b7f30950bd` (removed operation-door consent layer) and `82e2a185df` (refusal on unknown input fields). Done when the test passes or is deleted as protecting no contract.
