---
id: 01a14bc5-0df5-77c8-b1a2-694599fa9ace
title: Agents record friction with Tagma itself as reflections in the Tagma graph, and they stand until something answers them
ord: 9
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-693cdef49593
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/work/filedReflections.ts
  - kind: symbol
    ref: apps/tagma/server/src/composition/developer/modules.ts
    symbol: MODULES
  - kind: symbol
    ref: apps/tagma/server/src/graph/contract/wire/operations/reflections.ts
    symbol: REFLECTION_OPERATIONS
  - kind: symbol
    ref: apps/tagma/server/src/reflections/contract/wire/operations.ts
    symbol: REFLECTION_FILING_OPERATIONS
  - kind: symbol
    ref: apps/tagma/server/src/reflections/doctrine/friction.ts
    symbol: friction
  - kind: symbol
    ref: apps/tagma/server/src/reflections/filing.ts
    symbol: fileReflection
---
**Value.** A wrong refusal, a hung call, or a step done by hand for want of an operation never gets lost in correspondence. The agent himself records it in the Tagma graph, and the record stands until answered with finished work, a commit, or a check. That is the feedback channel to Tagma developers.

**How.** `file_reflection` and `read_reflections` file and read reflections; `answer_reflection` and `unanswer_reflection` set and withdraw the answer. Instructions tell the agent to file a reflection himself, with no question. The reflection page shows what was called, expected, and happened.

**Behaviour.**
- A reflection always lands in the main Tagma-sources checkout's graph, from whatever project or worktree it was filed. A project-registry change updates the source-checkout definition for the server context already open too.
- The filing answer names similar standing entries. A repeated sighting appends to the already standing entry. Reading groups unanswered observations under a standing parent; after the parent's answer they stand as separate rows. The group counter counts only standing observations.
- A reflection stops standing when finished work grew from it, when answered, or when replaced. An answer's commit must stand on the main checkout's branch.

**Limits.** Filing and reading exist only in a developer server build, and they need a registered project with Tagma sources. Answer and withdrawal exist in any build.
