---
id: 01a14da4-e479-7e48-886c-6815ad30e657
title: "Snapshots around bash through the observation-process cursor: a change-source port in agent-tools, subscription over command time, delivery barrier, status by paths, HEAD and index by content, the event moment"
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c68-ea98-7334-8861-317dd11a1f05",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a14d98-e0c1-7622-a276-d30446bb0015
sources:
  - kind: file
    ref: packages/agent-tools/src/CheckoutBaselines.ts
  - kind: file
    ref: packages/agent-tools/src/ShellRun.ts
---
Snapshots around bash through the observation-process cursor: a change-source port in agent-tools, subscription over command time, delivery barrier, status by paths, HEAD and index by content, the event moment.

Step 4 of the spec's [[46bb0015]] (item 5). Independent of roles. Proof is the spec's acceptances 4–5.

## Result

Commit `8548b6bb2b`. The device is [[860acc08]], the observation-process protocol (`settle`, `heard` interval) is [[e611425d]].

**Equality with a full snapshot.** `checkoutCursor.itest.ts`: 16 scenarios (record, untracked directory, deletion, rename, directory move and deletion, staged and `rm --cached`, skip-worktree, commit, `checkout --`, stash, a neighbour's `git status`, 300 files, `.tagma` without an owner, nested `.gitignore` — whole) plus cursor loss; the main checkout and a linked worktree. Every step is checked against a full snapshot and verifies that status was read by paths. Green on macOS and in Linux Docker (arm64); red when the index diff is off. Without the port the path is unchanged (`CheckoutBaselines.itest`, `bash`, `tools` — 109 pass).

**Measurements** (one sample, a busy Mac, ~10 agents, load 7–10; p50/p95 of open+finish snapshot pairs, the bench directly over `CheckoutBaselines`):

| scenario | whole | through cursor |
|---|---|---|
| quiet runlith clone, no changes | 696 / 986 ms | 22.7 / 29 ms |
| clone, 300 files recorded | 750 / 1183 ms | 222 / 677 ms |
| busy main checkout, no changes | 339 / 452 ms | 22.6 / 24.3 ms |

`settle` separately: p50 6–7 ms, p95 13–19 ms (10 ms FSEvents delay). The p50 ≤ 60 ms goal holds without changes; over 300 files it does not (222 ms — `git status` over 300 paths plus reading their contents).

**Review** (gpt-6.1-sol/xhigh): 7 findings, all confirmed and fixed — `settle` hanging on reset, index null/null past the full snapshot, subscription exceptions after rule changes, the `core.excludesFile` cache, hold never released in `forget`, heard intervals lost across interleaved snapshots, `heardAt` stamped in JS (now in the engine's OS thread).

## Not proven

- `ShellRun.open+finish` through a built server under several agents: the bench measured snapshot pairs directly.
- Measurements on Linux; the spec's acceptance 6.
- Epoch change through a live subscription and observation-process loss mid-window — only on the `ChangeSource` double; reopening a subscription on rule change — without a separate test.
- The `HEARD_LATE_MS` boundary (100 ms) — an OS-delivery assumption, unmeasured.
- Linux `limits.itest` "overflowed inotify queue" once missed 5 s on a parallel run; twice green standalone.
