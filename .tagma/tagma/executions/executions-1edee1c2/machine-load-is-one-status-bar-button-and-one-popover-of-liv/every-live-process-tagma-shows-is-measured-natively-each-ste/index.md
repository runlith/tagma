---
id: 01a0ef62-bd2c-75a6-9efa-3ad2b5f88bb9
title: Every live process Tagma shows is measured natively each step — rate from per-process CPU deltas, partial rather than refused, memory as the platform's footprint — while a load subscriber stands
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/execution-host/src/commandUsage.ts
  - kind: file
    ref: packages/execution-host/src/posix/macos/evidence.ts
  - kind: file
    ref: packages/execution-host/src/ProcessUsage.ts
  - kind: symbol
    ref: packages/executions/src/protocol/evidence.ts
    symbol: UsageReading
  - kind: symbol
    ref: packages/performance/src/protocol/records.ts
    symbol: loadSubjectSchema
---
## 1 Outcome

Every process the popover shows is measured each step with a processor rate and the memory it really holds, read natively, without spawning a process per reading. The processes are an agent's commands and terminals, the operator's terminals, Tagma's own processes, and the orphans. A rate is never blanked because one process of a tree was born, ended or unproven within the step. What the step could not cover is named beside the figure, and the figure stands as partial.

## 2 Problem

The measured facts are in the parent's §2. The owners' side of them:

- **The rate refuses the whole tree.** `ProcessUsage.ts#rateOf` answers `Unknown` when the earlier reading lacked the leader. It does the same when any process lacks a start stamp the reading could read (`identity-unproven`), when a pid holds another process (`identity-changed`), or when a counter went backwards (`counter-reset`).
- **Two readings are needed, taken on demand.** A rate needs two readings of one execution, and `commandUsage.ts#measuredRows` reads the latest one only when the feed asks. A short command therefore ends before it has a second reading.
- **The darwin reading spawns `ps`.** It spawns `ps -o pid=,ppid=,pgid=,lstart=,rss=,time=` (`darwinProbe.ts#usage`). The `lstart` stamp has one-second resolution, so a pid reused within a second cannot be told apart.
- **Memory is a resident-set sum** ([[ed976314]]).
- **Terminals and the installation's own processes are not read.** No producer of the declared `Installation` and `Machine` load subjects exists in the tree.

## 3 What holds now

- **The readings.** `ProcessUsage` retains readings per execution under a `UsagePolicy` (population × samples × `USAGE_READING_BYTES`). A reading names the relations it measured, and the regions it did not reach ([[9e5a4740]]). It carries wall and monotonic time apart ([[2a72c7fd]]).
- **The rate.** It is refused on a leader the earlier reading never held ([[c21f04a9]]). An underivable rate is `Unknown` with its reason, never zero ([[fc25b155]]).
- **The native library.** It already answers a launched child's cumulative CPU and peak resident set at its end (`native/Abi.ts#usage`, `native/PipeChild.ts`).

## 4 Target model

- **The sampler.** One sampler in the execution host takes a step over three sets:
  - the process sets of every live execution the host holds, commands and terminals alike;
  - the installation's processes: the server, its children and the host;
  - the machine's busy share.
- **Native per-process reads.**
  - **darwin.** libproc `proc_pid_rusage` gives user plus system time and `ri_phys_footprint`. `proc_pidinfo` (`PROC_PIDTBSDINFO`) gives the parent and the start time to the microsecond, and that start is the process's witness. `host_processor_info` gives the machine's busy share.
  - **Linux.** `/proc/<pid>/stat` gives times and start ticks. `smaps_rollup` gives Pss, and `/proc/stat` the machine.
  - **Windows.** The process's times and private bytes, and the system's times.
  - **Fallback.** A platform without a native reader keeps today's listing. Its figures carry the resident-set label and its known resolution.
- **Machine memory.** The machine reading also carries total, used and available memory and the platform's pressure level, read natively:
  - darwin: `host_statistics64` (`HOST_VM_INFO64`) for the page counts and `kern.memorystatus_vm_pressure_level` for the level;
  - Linux: `MemTotal`/`MemAvailable` from `/proc/meminfo` and `/proc/pressure/memory` where present;
  - Windows: `GlobalMemoryStatusEx`, with the level derived from its memory load.
  The source of each figure is named in the reading.
- **More sets.**
  - The installation set takes the desktop shell's processes (its main pid and descendants) when the server is started by the shell, handed over the same way as the server's own pid.
  - Residuals: a process the host's ending reports as having survived its sweep stays measured in an orphan set, with its origin execution and the witness the ending reported, until it ends or the operator ends it. The ending's sweep of the execution's group is unchanged, and no residual is inferred from a pid lookup after the ending.
  - An execution running in a sandbox guest answers an unmeasured region "runs in the sandbox guest" instead of host figures; the guest's own measurement is a later decision.
- **The rate over a step.** It is the sum, over the tree's processes, of each process's CPU increase divided by the monotonic step.
  - **A process born inside the step** counts all its CPU: its start, read from the witness, falls after the earlier reading.
  - **A process that ended inside the step** loses only its last fragment. The figure is marked partial, with the count of departed processes.
  - **A pid whose witness changed** is a new process. The old one is departed.
  - **A counter that went backwards** drops that process from the step, marked partial.
  - **Refusal.** The rate is `Unknown` only when nothing of the tree was measured, or when the leader was never measured at all ([[c21f04a9]]'s anchor stays).
- **Memory.** It is the footprint (darwin), Pss (Linux) or private bytes (Windows), labelled with its kind. The resident sum stays in the reading, for the hint and for a host that cannot read the footprint.
- **The step.** The sampler runs while the server's load feed has a subscriber. It samples every 1 s while a subscriber declared interest (the popover is open), and every 5 s otherwise. With no subscriber it takes no step. The same steps produce the performance ring's `Execution`, `Installation` and `Machine` load records the schema already declares.
- **Attribution of Tagma's work.** A process an act of Tagma starts through the admitted road carries the calling thread its admission recorded. The sampler reports the thread on the row. A process the server starts outside that road — git in the graph write-through, the SQLite children — is reported by role, with no thread.

## 5 Owners and boundaries

- **`@runlith/executions`.** The protocol: `UsageReading` gains the memory kind and footprint, and a partial rate's population and gaps. A new `MachineReading` joins it.
- **`@runlith/execution-host`.**
  - The sampler, the native readers and `rateOf`'s new partial semantics.
  - The installation set: the server's pid, with its children found by parent.
- **The native library.** It gains the per-pid read and the machine read.
- **The server's `executions` module.** It asks for the step through the feed subscription, and it gives the host the server's pid.

## 6 Rejected

- **Keep `ps` and read it faster.** A process per step costs more than the reading it gives, and its start stamps cannot tell reused pids apart within a second.
- **Keep refusing the whole tree.** It blanks most short commands, and the figure the operator most needs — the fan-out of a test run — is exactly the tree that gains and loses processes.
- **Sample on a fixed clock always.** It costs the machine when nobody looks (rule [[2393aff1]]). The driver is the subscription (rule [[a00f91b0]]).

## 7 Acceptance

- **Partial, not blank.** A `bun test` that starts 30 short-lived workers shows a rate on every step it lives through, never `Unknown`. Its partial mark counts the departed workers.
- **Rates for short commands.** A command that ran 700 ms under a 1 s step shows its CPU at its end.
- **Honest memory.** On darwin the server's row reads its footprint, within 5 % of `footprint -p <pid>`.
- **Cheap to take.** One step over 200 processes costs under 1 % of one core, measured by the host's own span.
- **Machine memory.** On darwin the reading's pressure level matches `memory_pressure`'s, and available memory is within one page-count step of `vm_stat`'s free plus inactive plus purgeable.
- **Residuals.** A plain `sleep 600 &` is ended by the ending's sweep and never enters the orphan set. A `setsid`-escaped child the ending reports as residual is measured in the orphan set with its origin, and leaves it when it ends.
- **No subscriber, no work.** With no subscriber the host takes no step. The span count is zero over a minute.
- **Tests.** A unit test drives `rateOf` over born, departed, reused and reset processes and asserts the partial figures. A system test (`*.stest.ts`) measures a real child tree on the running platform.

## 8 What becomes of what stands

- **Rewritten:**
  - [[fc25b155]]: a rate is partial with named gaps, and `Unknown` only when nothing or no leader was measured;
  - [[ed976314]]: the figure is the platform's footprint, labelled, with the resident sum kept;
  - [[c21f04a9]]: the anchor stays, and born, departed and reused processes make the figure partial instead of refusing it.
- **Survive:** [[9e5a4740]] and [[2a72c7fd]].
- **`darwinProbe.ts#usage`** leaves the usage path on darwin. The process listing for everything else stays.

## 9 Order

1. The native per-process and machine reads in the library, with their tests.
2. `rateOf` on partial semantics.
3. The sampler and its sets, driven by the subscription.
4. The installation set, and the load records to the performance ring.

## 10 Contract

`UsageReading` fields are added optional in the host protocol, so a server reads a previous host's readings unchanged. The host protocol's version is raised. A server over an older host labels its figures resident and exact-or-unknown, as today.

## 11 Stored data

out: readings stay in the host's memory under the usage policy. The performance ring's load records use the schema that already stands.

## 12 Who may do what

out: reading usage is the host's own act, done for the server. No new operation is exposed.

## 13 Long-lived things

- **The sampler** lives while a subscription stands. The server's subscription ends when the last feed view leaves, and the host's sampler ends with it.
- **A host replaced** mid-subscription takes the subscription again from the server's reconnect, and its first step is a first sample for every tree.

## 14 Bounded resources

- **Population.** It is bounded by the usage policy's population, which keeps its meaning. Past the ceiling, trees beyond it are named unmeasured regions.
- **Step cost.** It is one native call per process and one per machine.

## 15 Rollout

The host is replaced by the usual update. Until then the server shows the old host's figures, labelled.

## 16 Failures

- **A read that fails for one pid** makes the tree partial with that pid named.
- **A native library that fails to load** falls back to the listing, and the reading says so.
- **A host that dies** leaves the feed at host-unavailable.

## 17 Observability

- **The host.** It records a `usage.step` span per step, carrying the processes read, the duration and the partial and unknown counts.
- **The ring.** The performance ring's load records make every step readable afterwards through `read_host_performance`.

## 18 Divergence

- **Sandbox guest.** The "runs in the sandbox guest" unmeasured region is not built here: the host interprets no environment id, and the server's environment owner declares the guest (assigned to the load feed's builder).
- **Roles.** The installation set names five roles; the host's own children read as `execution-host`, chosen by the nearest installation ancestor, and a row without a start witness or parent is left out and named as an unmeasured region.
- **The `ps` listing.** `darwinProbe.ts#usage` is removed, as §8 said: usage is read through the native reader alone. A host whose native library did not load serves no `load`, and does not announce it ([[26384316]], [[02451def]]); no `ps` reading is labelled native.
- **Memory shape.** The footprint is a `footprint` sibling of `memory` (`Measured{kind, bytes, processes}` or `Unknown`), and `ResidentSum` means the resident sum only; the previous release's two optional keys on it stay readable and are never written, so an old client reads a new host's inventory ([[ed976314]]).
- **Cadence.** The step period is the profile's `usage.periodMs` while a subscriber is interested and five periods otherwise (§4 said 1 s and 5 s); the performance ring writes a subject when it moved or every 30 s ([[975dc729]]).
- **Machine memory.** Darwin available counts free pages with speculative ones, plus inactive and purgeable; against `vm_stat` that is its free, speculative, inactive and purgeable together, not free, inactive and purgeable alone.
- **Contract to an older host (§10).** A server over a host that does not serve `load` refuses it locally and names the capability ([[3283ebae]]); no inventory-labelled figure stands in for it.
- **Residual acceptance.** A `setsid` child is ended by the ending's own sweep and never enters the orphan set; a residual an ending reports is proven by unit and by a real-process fixture (`NativeUsage.stest.ts`), and no organic case is staged, because the ending's sweep ends every escapee it can prove and a residual is what it could not. The thirty-worker `bun test` case is covered by the born/departed rate tests, not a system test.
- **Measured (one machine, one sample each, load average 4.6).** A busy `yes` read 0.997 cores where the kernel's accounting gave 1.003, and four read 3.988 against 3.988; a touched 500 MiB allocation read 505.5 MiB of footprint; 200 native pid reads cost 0.9 ms of processor time; a step over one execution cost 0.49 ms, so the idle cadence of twelve steps a minute costs 0.01 % of one core. Linux and Windows readers are fixture-checked only ([[730a393c]]).
