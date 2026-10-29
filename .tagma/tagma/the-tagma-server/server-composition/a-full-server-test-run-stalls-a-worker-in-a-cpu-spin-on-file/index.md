---
id: 01a0d557-57ac-7933-91ac-35a2cfda2fc7
title: A full server test run stalls a worker in a CPU spin on files that pass alone, and its per-test timeout cannot fire
ord: 32
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d55b-6887-7419-a4ad-d64ecedf2b98",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/WorktreeFinishing.itest.ts
  - kind: file
    ref: apps/tagma/server/src/files/discharge.itest.ts
  - kind: file
    ref: test/residue.ts
---
**What was seen.** A full server run on 2026-09-24 (`bun test src --parallel=6 --timeout 20000`, bun 1.4.2, other sessions' load present) stalled with two files still running: `src/files/discharge.test.ts` at 397 s and `src/working/WorktreeFinishing.test.ts` at 286 s. Before stalling:
- 9 of the 10 discharge tests failed at exactly 20 s;
- "a merge queued while main is busy survives a restart…" ran 140 s, past the 20 s per-test timeout — the timer could not fire.

Two earlier runs that day stalled the same way, naming trivial files that pass alone in 0.3 s (`protocol/fields.test.ts`, `harness/capabilities/threads.test.ts`). The file a stalled worker names is not necessarily the one that stalled it.

**What the worker was doing.** `sample` of a stalled worker: its main thread ran JIT-compiled JavaScript and bun internals at about 79% CPU — a spin, not a blocked `ps` or `lsof`. Both stalled workers held `<defunct>` children, and one also held two live `sqlite-process` children. `discharge.test.ts` alone passes 10 of 10 in 2.5 s.

**Hypothesis, not established.** Test files that share one worker process under `--parallel` share process state that `--isolate` does not reset — `process.env` (the residue guard rewrites `TMPDIR` and appends to `RUNLITH_TEST_RUN` per file), the working directory, children and their exit handling. Something in that state sends a later file's code into a loop. One accumulation is certain from the code: `openRun` appends each file's own mark to the worker's `RUNLITH_TEST_RUN`, so the variable grows to `a:b:c…` over a worker's life, and every child a later file spawns inherits it. The `<defunct>` children are more likely a consequence than a cause, since a spinning main thread never reaps.

**Where to start.**
1. Reproduce: the full run, or the files one worker ran before a stall. The worker's temp root `/tmp/runlith-test/<pid>.*` names its current file's fixtures.
2. Capture a JavaScript stack of the spinning worker. A native `sample` shows only JIT frames.
3. Fix the loop at its owner. If the owner is product code — a retry without a bound, say — fix it there, not in the test.

**Done when** ten consecutive full server runs end without a stall, and the loop's owner carries the fix and a claim for it.

**Outcome (divergence).**
- **The loop is in bun, not in runlith code.** It is the wait loop inside `Bun.spawnSync` ([[42c25b2b]]); the fix upstream, oven-sh/bun#40078, is unmerged.
- **The hypothesis was wrong.** `process.env` does not carry over between isolated files, so `RUNLITH_TEST_RUN` does not accumulate. The `<defunct>` child is the spawnSync's own child, whose exit bun never observes.
- **What runlith carries.** Commit 63171fddc6 sweeps the retired global at the start of each file's preload. [[1227ccf8]] records it.
- **Acceptance.** On the operator's word, commands are bounded to 90 s, so full runs are not allowed. The ten full runs were replaced by repeated bounded runs of a 30-file stand-in: 0 of 78 wedged with the sweep, against 7 of 51 without it. Under the runlith preload: 0 of 14 with the sweep, 1 of 24 without it.
