---
id: 01a13d7a-587b-7ac5-be82-89e2a59cc76a
title: macOS lowest sometimes reads as normal through ps PRI at start and on the low to lowest switch
ord: 28
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16d96-a052-7354-9c5d-ee4b80725e3a",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13d2f-397e-77cc-90c3-6f03bdb21bcd
sources:
  - kind: file
    ref: packages/execution-host/src/hostProcess.itest.ts
  - kind: file
    ref: packages/execution-host/src/Pacing.ts
---
Find the cause and fix the flaky `lowest`-pace observation on the macOS execution host. `hostProcess.stest.ts:1754` (first paced-command run at lowest) sometimes sees `[20,20,20]` instead of `[4,4,20]` through `ps -o pri=`; `:1788` (low→lowest) sees `[20,20]` instead of `[4,4]`. The failure must never be hidden by awaiting a lucky retry, a skip or weakened contract assertions.

Reproduction: from `packages/execution-host` run `bun test --parallel=1 --rerun-each=3 ./src/hostProcess.stest.ts --test-name-pattern 'the agent-work pace'`. On clean HEAD `343bbfb251cb268df8490832ee3309d54675b1d067` in a separate worktree, after a frozen install and a `-j 1` native build, two runs gave 15/15 and 14/15; the second failed low→lowest. On the working tree with the store/registry migration two such runs gave 14/15 each, both failing initial-lowest. That is 29/30 against 28/30 on one machine; the sample never proves the rates differ. A full serial hostProcess repeat passed 39/39 in 40.10 s, while the previous full run failed initial-lowest.

Known chain: `registry/assembly.ts` passes `pacing.spawning` only at `launch.paced`; `native/holder/src/macos/spawn.rs` starts lowest with START_SUSPENDED, sets the Darwin BG and continues the child; `Pacing.hold/walk` paces proven processes and caches the applied pace by pid/birth, `ProcessWatch` calls `Pacing.follow` after the round. The store/registry migration never changed these acts or their arguments. Hypothesis: a race between setting Darwin BG/priority and the `ps` PRI read; unproven that `20` means the requested BG policy is missing. The shared root of initial-lowest and low→lowest is likewise unproven. An extra single serial run with live-thread witnesses before and after each ps gave 4/5 in 8.06 s: in the scenario of the refused lowest→low both pids showed ps PRI 20 and no background on any live thread; that is a genuine CPU-background loss in that refusal, not task-summary divergence. Initial-lowest and low→lowest in the same run were 4/background. Command `38736b95-a4df-4d3f-9cee-0e017221be52:166`; the temporary diagnostics are removed, assertions unchanged. The policy-loss cause is still undetermined.

The last reproducible initial-lowest refusal turned out to be a premature child read: right after READY `watch.rounds = 0`, the leader/child/unpaced PRI was `[4,20,20]`, BG `[true,false,false]`; after two finished rounds of the same host — PRI `[4,4,20]`, BG `[true,true,true]`. READY proves the shell started, not that the appeared child was walked. The test now awaits two watch completions to exclude an already started round with a stale table, then checks BG once through the adapter testing entry: the requested darwinbg and every live thread's priority. A passing BG value never conditions the retry. Scope stops its executions even on assertion refusal; previously they stayed alive and skewed later scenarios. Full hostProcess after the change — 28/28 in 37.43 s on one machine; a sample, not proof that no other cause of the old refusals remains. The changes have no joint review yet and are unlanded.
