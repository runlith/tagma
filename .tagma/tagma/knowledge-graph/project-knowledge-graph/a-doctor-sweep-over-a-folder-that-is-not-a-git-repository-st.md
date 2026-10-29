---
id: 01a0d6a4-2ef6-776f-bab4-0f0b45dc4255
title: A doctor sweep over a folder that is not a git repository starts no git process
ord: 148
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d68b-d81a-77e7-9609-3607dbc3ba68",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/measure/Doctor.itest.ts
---
**Measured on 2026-09-25** in `graph/measure/Doctor.itest.ts`: 8.2 of the file's 15.9 s of processor time is child processes. Among them are about 370 git processes the sweeps start (`rev-parse`, `ls-files`), at about 7 ms each, most of them over folders that are no git repository. Every doctor sweep in the product pays the same.

**Fix at the owner:**
- A sweep learns once that a root is no repository, or asks git once per root per pass, rather than per read.
- A repository root keeps what the sweep read in one pass instead of asking git again.
- Behaviour and findings stay the same.

**Done when:**
- the git processes a `Doctor.itest.ts` run starts, and its processor time, are named before and after;
- the claims over the changed sweep code are revised.

Part of the test-speed work of [[e24637ca]], because the graph suites carry this cost too.