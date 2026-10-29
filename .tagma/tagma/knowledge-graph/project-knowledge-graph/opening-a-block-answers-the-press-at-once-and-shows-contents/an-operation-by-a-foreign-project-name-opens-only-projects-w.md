---
id: 01a14c0c-b751-7184-bed0-bdcf629c830d
title: An operation by a foreign-project name opens only projects whose index holds that name
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14bf1-c8af-7caa-9840-1e1ee231c4b7",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a14c0c-6747-7325-a0f7-f79c508c4ca4
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/operations/crossing.ts
---
`crossing.elsewhere` (`graph/operations/crossing.ts`) opens the full graph of every registered project to judge ambiguity; a dead or foreign name costs opening every graph after a server restart. Ask the copy index from the spec and open only projects whose main copy holds the name or has no index. Proof: a test on three projects — another project's block is found, a dead name opens no graphs (`pool.held()`), cross-project ambiguity refuses with `ambiguous-name`.

**Result (commit dd566e0cc4).** `crossing.elsewhere` asks the copy index (`indexHolding`) and opens only projects whose main copy holds the name — live or in trash, so `restore_block` by a foreign deleted block's name works — has no index, or is unreadable. A test with a real pool was not written: the proof is a trace of a trial server where every `crossing.readProject` except the name holder takes 0.0 ms on a dead name. Found and removed there too: `SourceProject.project` called `git rev-list --max-parents=0` over the whole source history on every call (79–111 ms in the trial-server trace, p50 64–128 ms on the operator's live server); the source identity is now computed once per process.
