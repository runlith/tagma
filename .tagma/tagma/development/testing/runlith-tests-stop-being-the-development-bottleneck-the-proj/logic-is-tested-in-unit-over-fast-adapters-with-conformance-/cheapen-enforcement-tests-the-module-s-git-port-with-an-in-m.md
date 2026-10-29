---
id: 01a16dee-2f94-741a-9871-e27ccddeaa11
title: "Cheapen enforcement tests: the module's git port with an in-memory adapter; remeasure/ruledIn/court logic to unit"
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16a94-8d3a-7610-abd9-8503665bc41f",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16b01-cb85-7e31-9936-47664dbd9a84
---
Package `x10/enforcement.tsv`: 88 files in `apps/tagma/server/src/enforcement` and `composition/testing/enforcement`, 379 s CPU before (measurement [[08f81bea]], seed 1). Goal ≈ −91%. Remeasure, ruledIn, config reads and the court go through whole worlds with git today ([[afa44677]]); the main lever is a module port for what enforcement needs from git, with an in-memory adapter; narrow itests remain only for real commit hooks and gates. Ledger — `x10/x-enforcement.tsv` in the orchestrator's scratch.

**Port decision.** An enforcement git-module port with an in-memory adapter moves no file of the package to unit: every scenario needs graph documents (SQLite, stays itest) and inspection workers — separate Bun threads with their own git; main-thread git on enforcement acts is single cases ([[afa44677]]), while in landing tests almost all git sits in `Holdings.judge` and `submitWork` (change-record, landing). The orchestrator agreed; levers are deleting covered paths, merging scenarios over one world, moving off private worlds (native door, execution host, landing variants) onto shared ones.

**Result over 18 ledger files.** Before — 203.9 s CPU (measurement [[08f81bea]], quiet window). After — about 141 s CPU in runs under load from 42 agents (up to 6x by wall), so indicative; the number that counts is the quiet measurement at 17:30Z. In passing: `tagma check` CLI loads one verb of its own ([[c4fdb83b]]) — 1171 → 452 modules, ~1.0 → ~0.4 s CPU per start and per user `git commit`; the red `workers/modules.itest.ts` from [[08f81bea]] — the testbed cleanup after the previous file dropped the template (fixed in files; testbed is x-worlds' owner). The package's other files went to x-worlds. After the directory split my 19 more untouched files `src/enforcement/**` are 22.3 → 14.8 s CPU with no edits — conformance of real adapters and `heldDebt` (the landing contract); there is nothing to cut in them, the analysis is in the ledger.
