---
id: 01a0d168-f840-7717-8bde-90cff1d9b6a7
title: "Stage 3a review fixes: one member budget per watcher round, ended sets leave the watcher, witness errors are not disappearance, monotonic rounds"
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d137-9467-7eeb-83ef-7c80038f3426",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0d137-0ca1-7572-ae3b-6bb3e6f9bdcc
  - kind: implements
    to: 01a0cfa1-81c1-714d-83d1-1b6713e3cf43
sources:
  - kind: file
    ref: packages/execution-host/native/src/process.rs
  - kind: file
    ref: packages/execution-host/src/ProcessWatch.ts
  - kind: file
    ref: packages/execution-host/src/ProvenSet.ts
---
These are the confirmed findings of the stage 3a review of commit 847a3c2b72 ([[e6f9bdcc]]), from `review-set-opus` and `review-set-sol`. Where the two reviewers conflicted, Opus's reading decided.

**Bounds**
- **One budget for the whole round.** The cap is per set, but a round walks every set in turn. It costs about 870 µs + Σ members × 104 µs, and two full sets already fill the period.
  - Bound the round's member work across all sets, so a round stays inside half the period.
  - Split the facts calls into chunks that yield the JS thread; today one capped set is a single 180–500 ms synchronous call.
  - Concurrent ladders and the watcher share one table reading per gap. Today every stop re-reads the table every 50 ms, which multiplies under a shutdown that stops many executions at once.
  - Re-measure the per-member cost on a large synthetic tree of thousands of members before trusting the 104 µs p95 at scale.
- **An ended execution leaves the watcher.** Today a set stays iterated and held, facts included, until retirement, and a residual execution never retires. Once the ending takes the set, keep only the pid and witness of each residual member for `sweepResidual` and `remeasured`.

**Identity**
- **A failed witness re-read is not a disappearance.** `process.rs#encode` maps every second-identity failure to `ESRCH`, and `withFacts` evicts on it. Pass the real errno. Only a changed witness or a genuine `ESRCH` is gone; any other failure leaves the member unreadable, and it stays.
- **Choose the out-of-group aims before the group signal,** from the reading that step began with. A member that leaves the group after the group send gets its own signal at the next step, never twice in one step.

**Time:** schedule rounds and measure durations on a monotonic clock. The wall clock is for `bornWithin` alone. A backward wall step today stalls the watcher, and a forward one counts phantom delayed or skipped rounds.

**Tests**
- Clean up real processes on every path:
  - in `ProvenSet.test.ts`, the setsid escapee is left behind when discovery fails;
  - in `nativeLaunch.test.ts`, the orphaned 31-second sleep is killed outside any `finally`.
- Cover:
  - a member that survives the ladder outside the group, named as `ancestry` residual;
  - `unprovenInGroup` naming;
  - `sweepResidual` and `remeasured` acting only on witnessed pids;
  - a natural end signalling no member;
  - a zombie member never signalled and counted gone.
- Delete the wording assertion at `nativeLaunch.test.ts:153` ([[f0530b87]]).

**Nits**
- In `left()`, a residual's text says what reached that member, not the set-wide `aimed` flag.
- Set `ignoreBOM: true` on the decoder.
- `remeasured`'s reason for an unreadable pid is wrong: it says "still names a process" for a pid it could not read.

**Claims**
- [[31b184fb]]: another user's arguments refuse with `EINVAL`, not `EPERM`.
- [[231d9c4f]]: the bound is the round's, and "never" is overbroad: a refused child can be proven once a slot frees, while `capped` stays set.
- [[863148a6]]: the arguments are named only when they were read.
- [[3cef0adf]]: say what protects a group id in the residual sweep — the leader is kept unreaped under `WNOWAIT` while its group has members.
- [[9c1db3f6]]: drop the absolute uniqueness assertion.
- [[760d67c8]] and delta [[66c15f98]]: the set leaves the watcher at its ending.
- Narrowest sources for [[e872a2eb]] (`ProvenSet.round`), [[451f849a]] (`bornWithin`), [[8d973d5a]] (`process.rs#encode`), [[3cef0adf]] (`sweepAfter`) and [[a5ee14db]] (`PipeProcess.ts#endChild`, `nativeLaunch#stopPipes`).

**Kept as they are:**
- The skipped-round count is "whole periods in which no round started".
- The birth window brackets the spawn call. A pid is reused only after the pid space wraps, so a reuse within milliseconds is not a practical risk.
- On a pty, the first step's SIGHUP may reach a foreground job more than once ([[c7430581]]).
