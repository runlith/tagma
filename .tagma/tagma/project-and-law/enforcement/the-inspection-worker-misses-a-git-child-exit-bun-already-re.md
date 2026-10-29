---
id: 01a16e63-dd41-7533-993a-539ece21892a
title: The inspection worker misses a git child exit Bun already reaped, and waits 30 s for replacement
ord: 78
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16ded-dc89-7007-819b-ee8182c1a18f",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16e17-e820-7c49-8513-b1553201be28
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/workers/waits.ts
---
The inspection worker missed a git child's exit although the process was already reaped. The hang detector replaced the worker with a fresh one only after 30 s, and that term matched the test timeout.

**Evidence.**
- `/tmp/xw-rp.log`, x-worlds order (seed 1, `--parallel=1 --no-isolate`, 9 files of `composition/testing/enforcement/*`). Log line: reach worker 1 stuck on a history ask: "never saw the exit of git … rev-list --reverse --topo-order --parents … (pid 46142, system: gone)", waiting in `inspecting.historyAt` → `inspecting.historyListing`. The `remeasurePrograms` test fell on the 30 s timeout.
- The same order on HEAD 60dd45dc passed green 4 of 4, with no "never saw" line. No reproduction.
- `ps -o pid=,stat= -p` on macOS shows an unreaped child as `Z`; that's verified. So `gone` means already reaped, not a lost event on a live zombie.
- Bun 1.4.3 source: every path that reaps a process delivers the `exit` event to `node:child_process`. That's kqueue `NOTE_EXIT` → `wait4`, `ESRCH` → blocking `wait4`, and `wait4` error → `Status::Err`. The `exit` event completes the Deferred Effect that `isRunning` reads. The "reaped, exit unseen" state is a loss inside Bun between reap and JS. Its place isn't found: a one-shot loss in a re-entered tick ([[d9aef9cf]]) would leave a zombie, not `gone`.

- Second place: `escapeOrigin.itest.ts` on HEAD 84998fdd (2026-10-24, load ~22 on 12 cores, `--parallel=1 --no-isolate --seed=2`, the file ran alone). A shim on git in PATH wrote each process's pid, start and end. Red on the 10 s timeout in 2 of 27 passes (26 and 36). In both, the first git of the first request to the inspection worker, `rev-parse --verify <commit>^{tree}` (reach treeId), started and ended with `rc=0`: the shim recorded the end and exited. After that the worker launched no process until the timeout, although green passes immediately follow with `ls-tree -r -l -z`. Test body over 10 s wall — 0.9 s CPU. Bun kills exactly one hanging process, a long-lived `cat-file --batch` of the main flow, removed in green passes too. So the worker's child had already exited. A test with a 10 s term turns red earlier than the detector replaces the worker after 30 s, so every such loss is a red itest. Logs: `/tmp/xl-gz26.log`, `/tmp/xl-gz36.log` (shim), `/tmp/xl-sp1.jsonl` (main-flow spawns of the first shimless reproduction).

**Reproduction.** The same sign — reaped, `exitCode` set, `exit` never arrives — reproduces in 4–11% of a file's first `spawn` under `bun test` at `node:child_process`; with `Bun.spawn` and outside `bun test` there are no losses ([[26f52110]]). The Effect `NodeChildProcessSpawner` through which the worker runs git stands on `node:child_process`.

**Done (c891bbae67).** While the worker has a child with an unseen exit, the worker runs `kill(pid, 0)` every 250 ms. ESRCH on 6 probes in a row, i.e. no process for at least 1.25 s, and the worker reports `LostExit` to the lane and repeats it on every following probe. The lane stops the worker. If an ask waits on it, it leaves for a fresh worker with one retry; when idle the worker just stops. The loss is a defect of the whole worker, not of one ask: `cat-file --batch` lives across asks. A Bun answer arriving anyway still completes the wait. The old `ps` check still catches zombies: `kill(pid, 0)` on a zombie succeeds. A reused pid only misses detection, never a false one: while the child isn't reaped its pid is taken. A false positive costs one repeated ask. It's possible when Bun reaped the process but delivered the exit later than 1.25 s, as on the Linux waiter-thread path. The root on our side — running children via `Bun.spawn` — is the [[48eacba0]] task.

**Passes** (`escapeOrigin.itest.ts` alone, seed 2):
- before the fix, load ~22: 2 hangs of 27;
- with a 3×500 ms threshold and shim: 30 passes, 2 losses caught, both tests nearly reached the end and hit 10 s on the slow shim;
- with a 5×500 ms threshold, load ~20: 40 passes, 2 losses caught, 1 red — a fresh worker from cold didn't fit the remaining term;
- with the final 6×250 ms threshold, load 11–15: 40 of 40 green, 1 loss caught, the test passed in 5.0 s.

`Inspections.itest.ts` and `workers/inspecting.itest.ts` green on seeds 1–3, review — openai-oauth gpt-6.1-sol xhigh.

**Proposal (original).** The spawner wrapper in the worker (`watching` in `waits.ts`) asks `kill(pid, 0)` for every child whose exit is unseen. ESRCH on two questions in a row is a fact: the process is reaped with no exit. The worker immediately reports this to the queue, which fails the request and repeats it once in a fresh worker under the [[806049cb]] policy, instead of waiting two 15 s polls. Zombies are still caught by the `ps` check in the queue.

**Why no test through a seam.** The loss is caused by Bun, it can't be triggered from the public door. A test could only swap the handle or `kill` and check the mechanism through a seam, and that's a forbidden test shape. The fix is proved by no 30-second hangs on passes where they appeared.
