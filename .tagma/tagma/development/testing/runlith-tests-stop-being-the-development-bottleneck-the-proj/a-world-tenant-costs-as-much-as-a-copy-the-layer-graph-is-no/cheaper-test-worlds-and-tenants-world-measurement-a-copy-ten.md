---
id: 01a16ded-b774-7fee-9e33-f6c0145bb135
title: "Cheaper test worlds and tenants: world measurement, a copy tenant for runtime, fewer own-worlds, world assembly"
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16a94-8d3a-7610-abd9-8503665bc41f",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16af5-72c5-7950-b64c-533614455f40
---
Part x10 (worlds agent): the cost of the test stand's worlds, tenants, and processes. Ledger — `x10/x-worlds.tsv` in the orchestrator's scratch.

**Done.**
- The stand (`packages/testbed`): git in tests on macOS bypasses the xcrun shim (22.5 → 10 ms CPU per git process; [[5294065f]]); child bun takes the real transpile cache (0.40 → 0.18 s CPU per launch); `maintenance.auto`/`gc.auto` off in the stand's git config; a lost world reaper is replaced and receives the whole held list ([[b36476b2]], [[cb987f4b]]); a directory created by the next file at import is not wiped by the previous file's cleanup under `--no-isolate` ([[131e63f6]]); a file with no finished test no longer yields a negative world entry ([[cd1e8244]]).
- Fixtures: one file observer per worker instead of a process per file or tenant; the graph tenant's template carries the global project's root — the tenant launches no git (was 3 processes); the app's unused `pageWorld` and its server removed.

**Measurement (indicative, under load ~20, one sample).** actDoor + terminalGuidance + approver: 31.1 → 21.4 s CPU, including in-process SQLite x-sqlite; door world assembly 5.4 → 3.4 s.

**Not done, and why.** A copy tenant for the runtime world: a stealth project is machine-base lines, a mirror, a shadow `graph.git`, and a tree, all bound to the project's id and root; a copy would bypass `add_project` and diverge from the product. Birth now costs ≈1 s of its own process CPU and 29 git; further slices sit at the producer: birth SQL (the statement cache, x-sqlite) and the second topology sync in `GraphPool.open` (the graph owner). 9 own door worlds remain; each changes the whole machine's state (plugins, accounts, settings, maintenance, the Cursor catalog), and no cheap faithful loan exists for them.
