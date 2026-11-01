---
id: 01a18f17-c40e-7223-a9df-7b9b177a82c5
title: A testbed bench runs N agents through the server's real doors and measures cost per act, the loop, memory and interface latency
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19438-d00e-77e1-ab7e-0c5c3fd9e78b",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a18cde-5f93-73e8-aa31-64572afe6fec
---
Step 0 of [[2afe6fec]], second half: a load bench that runs N agents against one in-process server through its real doors, so the baseline and every gate of that spec can be measured. It is a testbed bench (`*.bench.ts`, as `executions/commandFeed.bench.ts` and `execution-host/src/hostLoad.bench.ts` are), not a live check.

Workload, open-loop arrivals:
- a fake runner per hosted agent calling `open_hosted_turn` and `call_hosted_tool` at 0.1 call/s with the incident mix (`read` 64%, `grep` 15%, `bash` 10%, `glob` 3%, graph reads the rest) over a fixture repository;
- a fake ACP CLI per ACP agent at 2.6 frames/s (text chunks, tool-call starts and status changes, message boundaries);
- one agent in five idle on the model (beats, leases, keep-warm);
- subscribers as at the incident's longest stall: `thread.changes` ×8, `artifacts.thread` ×8, `worktrees` ×6, and `commands`, `threads`, `calls`, `views`, `graph`, `holdings`, `checkout`, `tree` ×4 each; also a run with none;
- N = 0, 10 and 50, and a 5× rate stress run; payload size points as the spec's Proof lists them.

Each run reports: server CPU and allocation per act, statements and write units per act from the causal ledger, with retention gaps and unfinished tails explicit, writer wait and hold p50/p99, loop delay p99 and stalls over 100 ms, collection pauses (`BUN_JSC_logGC`), RSS and heap over time, and the three interface boundaries: graph block open, thread open to the first usable frame, list update from its causing commit.

A memory census of the idle and the loaded bench server: heap after full collection by retainer (heap snapshot), native and allocator memory.

Short runs come first; the steady-state run at N = 50 fits the project's 30-minute command life whole, as the spec's Proof says. Done when the bench runs at N = 0, 10, 50 and its baseline figures and the census are written into [[2afe6fec]].
