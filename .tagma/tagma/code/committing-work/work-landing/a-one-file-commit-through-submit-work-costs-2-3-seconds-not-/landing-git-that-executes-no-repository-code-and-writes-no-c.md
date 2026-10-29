---
id: 01a15417-b33a-7058-b932-71f4380e8c1a
title: Landing git that executes no repository code and writes no checkout files goes direct, with no execution host
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15419-53a6-72a9-93e4-65b5f17b40d2",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15417-4ea3-7cfd-8032-89c71b48552d
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/commands/admittedGit.ts
  - kind: file
    ref: apps/tagma/server/src/executions/commands/servingGit.ts
---
A landing accounts for 20 git calls through the host, 90–180 ms each vs 10–15 ms direct. Through the host stay commit steps, hooks, and everything writing checkout files or executing repository code. Reads and writes to the server's internal index go direct. This revisits the [[27cfd1e3]] decision to keep admission on every git, on the sample's basis in the spec. Landing cancellation and typed refusals must stay. Proof — host-routed call count and landing time before and after.

## Result

Commit `4225f9be8e`. How it works — [[11609ccf]]. Through the host stay `git hook run`, the publication `update-ref`, and `merge --quit`; everything else goes on the server's own git.

Sample — a temporary probe over `makeDoorWorld` with a real execution host (copy: the performer's scratch thread, `gitRoadProbe.stest.ts.txt`). Scenario: its own checkout, a `sh format.sh` commit step, no rules or hooks, 8 landings of a one-line edit in a row; landings 2–8 count (n=7). Machine load uncontrolled: other agents ran a heavy command in parallel.

| | Before | After |
| --- | ---: | ---: |
| git through host per landing | 20 | 1 (`update-ref`) |
| sum of these calls' time, ms | 577–996 | 15–127 |
| `submit_work` from prepare to answer, median, ms | 2248 (1885–2599) | 1586 (1476–2076) |

A second "after" run under heavier load gave a 3392 ms median, but no paired "before" in the same window. Call count is load-independent. On this stand one host-routed call costs ~40 ms; on the working server the spec sample says 119–177 ms on average.

Not proven:
- a full landing on the working server (needs a restart, done by the operator);
- hooks through `hosted` on a real host: the admittedGit path did not change, and hook tests run on the platform's git;
- Windows.
