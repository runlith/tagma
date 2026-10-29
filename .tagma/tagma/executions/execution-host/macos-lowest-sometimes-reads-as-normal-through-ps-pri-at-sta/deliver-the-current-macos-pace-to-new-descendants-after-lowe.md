---
id: 01a14013-151b-7dba-af73-5b003a9c1bde
title: Deliver the current macOS pace to new descendants after lowest applies
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13fd0-aafb-7c4c-bb78-cce3611ba91a",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13d2f-397e-77cc-90c3-6f03bdb21bcd
sources:
  - kind: file
    ref: packages/execution-host/src/ExecutionTerminal.itest.ts
  - kind: file
    ref: packages/execution-host/src/Pacing.ts
  - kind: file
    ref: packages/execution-host/src/ProcessWatch.ts
---
Fix delivery of the current `lowest` to a new descendant on macOS at the pace owner. In `ExecutionTerminal.itest.ts` after `PaceReport {Applied, lowest, failed:0}` runs `sh -c 'sleep 0.3; sleep 30'`: past the same 2.5 s the leader had PRI 4 and background=true by every live thread's base priority, its fork PRI 20 and background=false. The full file gave 6/7; a narrow diagnostic run the same refusal. Assertions were never weakened. The link to the parent task's historic initial-lowest and low→lowest refusals is still unproven.

Chain as read: `registry/assembly.ts:170–171` holds `native.proven` in Watch and Pacing; `ProcessWatch.round` reads the table every `ROUND_PERIOD_MS=1000`, grows the ProvenSet, refreshes facts and calls followers; there is no fork subscription in that chain. `Pacing.follow` walks the leader and proven members under the shared change/hold permit, caching the matched pid/birth/target pair. Native `sys::tempo` checks birth and sets Darwin BG on one pid. Starting lowest sets BG on the leader before SIGCONT; later descendants are Watch/Pacing's duty. A plain change↔follow conflict and missing assembly registration were never confirmed by the code. Discovery skip, ancestry loss and exec-time cache-validity loss are still undistinguished; no safe root change follows from this data.

Start from one event-driven reproduction: apply lowest, let a fork through on a control event, await the new descendant's message; match the native witness, ProvenSet presence, the Watch round, the apply call and live thread base priorities. No fixed sleeps, skips, luck retries or registry normalization. Fix the proven owner and guard it with a "post-apply fork → descendant gets BG" contract, keeping full↔lowest, low↔lowest and unpaced work. Never pass CPU-background off as I/O-tier proof.

**Found October 15 (fix-graph-open, no code changed).** macOS itself lifts BG. Reproduced without Tagma: a C binding of `posix_spawn` (`SETSID` or `SETPGROUP`) → `setpriority(PRIO_DARWIN_PROCESS, BG)` before `SIGCONT` or on an already running process → `sh -c 'sleep 0.3; sleep 30'`. After ~300 ms, around the first child's exit and the next fork, the leader's and the descendant's PRI becomes 20 and never returns. In the host test the same — even with the apply to descendants off. `walk` caches `matched` and never reapplies. The actual state is read as `proc_pidinfo(PROC_PIDTASKINFO).pti_priority`: 4 for BG, 20 for normal; another pid's `getpriority(PRIO_DARWIN_PROCESS)` gives 0 and is unfit. Proposed fix: a holder batch frame "reconcile pace" that reads `pti_priority` and reapplies only the diverged; `Pacing.follow` calls it once per round instead of trusting the cache. Touches `frames.rs`/`frames.ts`, `sys.rs`, `Pacing`.

Evidence: execution `a08675e7-3bf4-496f-bf73-194891644bdf:166` — ExecutionRuntime 43/43 in 41.05 s; `ExecutionTerminal.itest.ts` full run `c6a2ac36-03af-4c74-90a5-1414f477f819:166` — 6/7 in 11.97 s. Narrow terminal-pace-witness of 2026-10-15 14:50:44: pid 76081 → 4/true, pid 76089 → 20/false, starting PaceReport Applied/lowest/reached=0/failed=0. Command: `bun test --parallel=1 ./src/ExecutionTerminal.itest.ts --test-name-pattern 'backgrounds a paced terminal'`; the temporary diagnostics are removed. Two allowed hostProcess filtered runs and their caps are kept in scratch `pacing-witness.md`; the second gave 5/5 in 2.45 s with spawning=lowest, which never explains the first genuine 4/5 refusal.
