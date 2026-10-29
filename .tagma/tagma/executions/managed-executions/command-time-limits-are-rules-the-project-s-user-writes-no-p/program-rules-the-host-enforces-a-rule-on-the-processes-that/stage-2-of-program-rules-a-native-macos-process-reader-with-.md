---
id: 01a0d111-f7a4-7136-805e-cf2d3a6dc74e
title: "Stage 2 of program rules: a native macOS process reader with a start witness, and stray sampling moved onto it"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d112-2133-7797-a7ed-9fd521582c50",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0cfa1-81c1-714d-83d1-1b6713e3cf43
sources:
  - kind: dir
    ref: packages/execution-host/native/src
  - kind: file
    ref: packages/execution-host/src/strayProcesses.ts
---
This is stage 2 of [[13e3cf43]]: the process reader and moving stray sampling onto it. The host changes; the wire does not.

**Scope**
- **The reader port** is a host type with one implementation, for macOS, in the native crate `packages/execution-host/native`, loaded the way the crate is loaded now. For each process it answers:
  - pid, parent pid and process group;
  - arguments, from `sysctl(KERN_PROCARGS2)`;
  - executable path and working folder, from `proc_pidpath` and `proc_pidinfo(PROC_PIDVNODEPATHINFO)`;
  - a start witness, from `proc_pidinfo(PROC_PIDTBSDINFO)` `pbi_start_tvsec`/`pbi_start_tvusec`.
- **The reader offers two readings:** the table, or the processes under a set of roots, whichever the measurement shows is cheaper; and one pid read again, so a witness can be checked just before a signal.
- **A field that cannot be read,** such as another user's arguments or a process that exited mid-read, is answered as not read for that process. It never fails the whole reading.
- **Stray sampling** in `strayProcesses.ts` moves onto the reader:
  - the `ps` spawn and the recognition by command text are retired;
  - a sampled stray is recognised by pid plus start witness;
  - a pid whose witness changed is never signalled ([[69128217]]).
- **`ProcessUsage` stays as it is.**
- **Measure the cost of a round:** the per-member cost of a reading and the cost of a whole reading, on this machine, over a real tree such as a `bun test` run with workers.

**Out of scope:** the proven set, the watcher, matching, any wire change, and lifting the write refusal for program rules. All of that is stage 3.

**Where to start:** `strayProcesses.ts`, `ExecutionStop.ts`, `nativeLaunch.ts`, and `native/src/lib.rs` for how symbols are exported.

**Proof**
- Native tests over a live child cover:
  - arguments with spaces and newlines;
  - the folder after `chdir`;
  - the witness stable across reads;
  - an exited pid answered as not read.
- `strayProcesses` tests run over injected readings. A reused pid, meaning the same pid with another witness, is never signalled.
- The stop ladder's escapee case still ends a `setsid` child.
- `cargo build` passes, the typecheck is clean, and the host suite is green under the residue guard.
- No test asserts text ([[f0530b87]]).

**At finish**
- Write from the code the claims for the reader, and revise the claims over `strayProcesses.ts`.
- Record the measured costs as a claim with a `date` source. [[13e3cf43]] sizes the watcher's period and the proven-set cap from them.
- Re-read [[69128217]] against the witness.
