---
id: 01a14c13-c481-7acc-8aa6-03b4a952bc4b
title: The agent asks what its session holds and wrote, and whose lines stand in the way
ord: 2
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/contract/wire/changes.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/operations/changes.ts
  - kind: symbol
    ref: apps/tagma/server/src/change-record/contract/wire/operations.ts
    symbol: CHANGE_READS
---
**Value.** The agent sees its own by accounting, not by `git status`: what's still uncommitted, where others' lines stand nearby, where the rest went; on edit conflict — who's writing this path now.

**How.** The `read_changes` tool and operation, without asking the operator: about its own session, about a teammate session by team name or thread id, about a path or directory.

**Behaviour.**
- About a session: per checkout — uncommitted paths with its `+/−` and neighbours, unverified paths with cause, and paths outside git; commits its lines landed in that HEAD still reaches; how the rest of the lines left; each of its turns' paths with what stands of them now. An open command doesn't delay showing a proven landing, even while accounting retains its record until the command window completes.
- About a path: the accounting judgement — each holder with their lines, nobody's lines with cause or an unverified verdict, and the commit-step debts on that path.
- One `limit` is shared by the selection's rows: about a session — first checkout paths (an empty checkout takes a row), then `turns` and `unattributed`; about a path — `holdings` and `unattributed`. Observations go in record order. The shared `total`, per-set `totals` counters (`checkouts` counts checkout rows), and `next` allow reading the selection through; a vanished reference checkout or observation yields `cursor-stale`. `held` and `uncommitted` sums cover the whole checkout even on a partial page; commits and exit causes stand beside the page.
- `unattributed` names the thread whose command met the shift, not the lines' author. The answer covers all checkouts and projects where the session wrote.

**Limits.** This is accounting's judgement on the uncommitted, not history blame. An address nobody answers is a refusal.
