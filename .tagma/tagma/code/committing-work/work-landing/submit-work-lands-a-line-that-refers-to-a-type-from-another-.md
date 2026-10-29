---
id: 01a16a26-4ad8-77b0-9788-e408ef90b529
title: submit_work lands a line that refers to a type from another session's uncommitted lines, and HEAD stops compiling
ord: 100
tags: ["reflection"]
fields:
  {
    "actual": "Commit 0080905f57 carries only the pool line (1 insertion, 1 deletion in graph/contract/service/serving.ts). In HEAD `CopyWriting` is used (serving.ts:191) and declared nowhere: `git grep CopyWriting HEAD` finds one use. HEAD fails typecheck until format lands its lines.",
    "command": "submit_work (session pool, thread 01a16a00-dd72-7fd0-8c63-ec85cbaa1a59) in /opt/workspaces/runlith → commit 0080905f57",
    "expected": "The `ServedGraph = CopyWriting & {…}` line refers to `CopyWriting`, declared by session format's uncommitted lines in the same file. The landing either carries that declaration as a peer's dependent line (carried) or refuses naming the dependency."
  }
---
Line dependencies are judged by hunk adjacency, not by meaning: a reference to a name declared by another's uncommitted lines in the same file does not count as a dependency. A similar reference is probably in `delivery.ts` too (`release(place)`) — by pool's account, also from format's lines; unverified. Commit steps do not run typecheck, so the landing noticed nothing. Work: [[454f3ca6]].
