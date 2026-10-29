---
id: 01a14c14-a11c-7ce8-9d84-633e55d13f13
title: Agent cleans standing comments under a path with one call, without touching someone else's unfinished work
ord: 11
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: file
    ref: packages/agent-tools/src/sweepProse.ts
  - kind: symbol
    ref: apps/tagma/server/src/change-record/contract/wire/writes.ts
    symbol: CHANGE_WRITES
  - kind: symbol
    ref: apps/tagma/server/src/change-record/sweep/stripComments.ts
    symbol: stripComments
---
**Value.** A project that switched to a comment ban brings already written code to the policy with one call instead of editing every file.

**How.** The agent's `strip_comments` tool over a checkout file or directory.

**Behaviour.**
- Only prose comments go: comments with `!` and pragmas stay, a file with an exclusion mark stands whole, an unparsable file is named and untouched, nothing reformats.
- Every changed file records as this session's edit and lands with an ordinary landing; the graph does not change.
- A file where another session holds uncommitted lines is skipped and named with whom to ask.
- Git-ignored files, `node_modules`, and the graph directory are never read.

**Limits.** Only for Tagma threads and only where the policy bans comments; the operator calls it through an agent.
