---
id: 01a127ad-cc0d-7a03-b77a-95f17df613b0
title: "Host terminals and processes meet one contract set on every OS, with no contract regression on macOS: OS-neutral ports, a holder with a platform trait"
ord: 15
tags: ["spec"]
fields:
  {
    "status": "open"
  }
sources:
  - kind: dir
    ref: packages/execution-host/native/holder
  - kind: dir
    ref: packages/execution-host/native/src
  - kind: dir
    ref: packages/execution-host/src/holder
  - kind: dir
    ref: packages/execution-host/src/posix
  - kind: file
    ref: packages/execution-host/src/nativeLaunch.ts
  - kind: file
    ref: packages/execution-host/src/pipeLaunch.ts
  - kind: file
    ref: packages/execution-host/src/ptyLaunch.ts
  - kind: file
    ref: packages/executions/src/protocol/call.ts
---
Host terminals and processes meet one contract set on every OS, with no contract regression on macOS: OS-neutral ports, a holder with a platform trait.

The terminal and processes the host starts behave correctly under one contract set. On macOS they are no worse than the old host on any contract. Linux and Windows are new support: the old host never loaded there (`PtyLibrary.load` refused off darwin), and the measure for them is the same set, not "as before". Linux and Windows are added with adapters behind ports: the host core, registry, wire, and server do not change.

## What matters most

Terminal quality matters more than surviving an update — about 80 to 20. A terminal that works worse than before the holder makes the whole [[d86d6647]] line worthless, however well it survives a swap.

The old implementation is a lower bound, not a reference. The contract set, derived from what a terminal and a process must do (termios and session semantics, xterm, shell, vim, ssh, and third-party CLI behavior), defines correct behavior — not what the old host did. Hence:

- a contract the old host met and the new implementation does not is a defect of the new implementation, not the price of the holder; it is fixed before any next task of the line;
- a contract the old host violated is met by the new implementation; such places are named in the parity report as fixed;
- where recovery convenience argues with terminal quality (an extra hop, buffer, input or output delay), the terminal wins;
- no part of the line lands in main until proven on macOS (the "what shows it works" section).

## What the user gets

- In the Tagma terminal everything that worked keeps working: shell, vim, ssh, REPL, dev servers, third-party CLIs (Claude Code, Codex) in PTY and pipes, Ctrl-C, resize, alternate screen, large output, paste, a slow stdin reader.
- Stopping follows its own ladder and leaves no zombies or orphans from the proven set. The terminal ladder starts with hang-up; the pipes ladder — interrupt, terminate, kill; an execution whose leader already exited starts with terminate.
- On Linux and Windows — the same behavior where the OS allows it. Where it does not, the adapter does not declare the capability, and the host answers with a typed `unsupported` refusal; nothing is faked.

## Decision: our own implementation, portable-pty not used

The holder is an event loop over bare non-blocking handles it hands to the logic. portable-pty is built for another model (HEAD, `native/vendor/portable-pty-0.9.0/src/unix.rs`):

- `Child::wait` reaps immediately, while the holder must see the exit without reaping (`waitid` with `WNOWAIT`) and take the status on the logic's command;
- spawn goes through `std::process::Command` with `pre_exec`: `posix_spawn` flags (`POSIX_SPAWN_CLOEXEC_DEFAULT`, `START_SUSPENDED`, its own session) cannot be passed there;
- reader and writer are blocking, per separate threads; the writer on Drop writes a newline and VEOF into the terminal;
- `CommandBuilder` substitutes its own defaults (HOME for a missing or invalid `cwd`, login shell by `SHELL`), while we need exactly what was passed started.

Rejected:

- **A fork of portable-pty rewritten for us.** The whole unix part would be replaced, leaving third-party traits (`PtySystem`, `MasterPty`, `Child`) that fit neither the event loop nor handle handover, plus a fork to maintain.
- **portable-pty for `openpty` alone.** One libc call is not worth a dependency with a patch.

Its ConPTY part (`src/win/`, 513 rows) is a sample for the Windows adapter, but not its flags: `PSUEDOCONSOLE_INHERIT_CURSOR` makes conhost wait for a DSR answer at start, and `PSEUDOCONSOLE_WIN32_INPUT_MODE` enables input xterm does not understand (`psuedoc.rs:85-89`). The contract set picks the pseudoconsole flags; these two are forbidden.

## Arrangement

### Layers and modules

| Layer | What is in it | Knows the OS |
|---|---|---|
| wire `@runlith/executions` | start, stop, signal, answers, host capabilities | no |
| server | what to start, bundle preparation, host bring-up by manifest | no |
| host core: registry, record, screen, input, stop, rules, accounting | works through ports | no |
| core ports | `Holder`, `ProcessReader`, `UsageReader`, evidence, platform facts, pace, endpoint and credentials | no |
| host composition | picks adapters and binds them to the core | yes |
| POSIX adapter (macOS and Linux) | holder client, I/O of received fd, process table, evidence, platform facts, pace | OS modules inside |
| Windows adapter | same for Windows | yes |
| holder (Rust) | shared core and platform trait | core — no |
| logic native library (Rust) | I/O, readiness or completion, process table, accounting | each adapter its own ABI part |

- **One POSIX adapter for macOS and Linux** ([[6f758080]]: where one mechanism suffices, no separate adapters are started). Differences are OS modules inside it, as `native/src/usage.rs` already does. Windows is a separate adapter: a different handle, event, and stop model.
- **Composition is its own module or the top floor of the host module**, the only one allowed to import adapters. `main.ts` now lives in one module with the core, and the import check does not catch a core importing an adapter. While that stands, no core rule holds.
- **The core imports no adapter and branches on no OS** ([[6f758080]]). This is violated now, and all of it goes behind ports:
  - `src/native/Abi.ts` and `src/native/PtyLibrary.ts` take refusal types from `src/posix/native.ts`;
  - `host.ts` unconditionally loads `PtyLibrary` (an `unsupported-platform` refusal and an `os: 'darwin'` literal), calls `darwinStanding`, and branches `process.platform !== 'darwin'` before `darwinProbe`;
  - `registry/state.ts`, `registry/ExecutionRegistry.ts`, `ExecutionCapacity.ts`, and `registry/relief.ts` take a concrete `PtyLibrary` and `darwinStanding`;
  - `Pacing.ts` imports `native/Priority.ts` (`PRIO_DARWIN_BG` via `libc.dylib`, `backgroundable = process.platform === 'darwin'`);
  - `Credentials.ts` refuses on win32;
  - `nativeLaunch.ts` itself looks up the program on `PATH`;
  - `registry/endings.ts` (`residualAims`) signals a group by a bare id past the holder (`killGroup`, `groupStanding`).

### Core ports

- **`Holder`** — executions and acts on them (below).
- **Platform facts** — kernel limits and machine busyness for admission: how many terminals, processes, and handles can be opened and how many are busy. Limits an OS lacks are answered explicitly missing, not zero or invented. Handles are spent by the holder and the logic: admission takes the minimum of two independent budgets — each soft limit minus busyness, divided by the execution cost the owner declares. The holder counts the start peak, the logic counts copies of channels, records, readers, and temp files, plus a connection reserve separately. Steady logic busyness is measured after services and listener are assembled, before ready and intake open.
- **Pace** — set the pace at start and change the pace of live work both ways, for the leader and its descendants. A mechanism that cannot raise the pace back without privileges does not declare raising.
- **`ProcessReader`, `UsageReader`, evidence** — as now, but adapters. The birth witness is a pid and start time in the OS's own units: on Linux — ticks since boot (field 22 of `/proc/<pid>/stat`), with no wall-clock conversion, otherwise holder and logic converting separately would diverge on a clock shift, and `proofOf` compares strictly.
- **Endpoint and credentials** — unix socket and file rights on POSIX, named pipe and ACL on Windows.
- **Program lookup** — at the adapter, by the start contract below.

### The `Holder` port does not speak OS

- **Stopping is an act.** `interrupt`, `terminate`, `kill`, `hang-up` acts on a `leader` or `work` target (the execution's whole work). The POSIX adapter translates them to SIGINT, SIGTERM, SIGKILL, SIGHUP to the leader or group. Finishing work remainders (`residualAims`) also goes as a work act through the holder while the leader is not removed, and by witnesses afterwards.
- **Wire steps** are named acts (`STOP_SIGNALS` in `packages/executions/src/protocol/call.ts`), and so are remainder relations: `NativeRelation` `'process-group'` and `'same-tty'` (`protocol/capacity.ts:96`) become the execution's work and terminal, and `NativeProcess.tty` (`protocol/launch.ts:54`) an optional terminal name the adapter gives when it has one. The server and the feed show the act.
- **An arbitrary named signal** is a capability; an adapter that did not declare it answers `unsupported`, as `SignalAnswer` does now.
- **Execution work.** The port returns the work identity, and its makeup is answered by the platform: a process group on POSIX, a Job Object on Windows. The proven set and stopping ask "members of work W" and never compute them from pgid.
- **Terminal** — read, write, resize, size, and `interrupt` as a terminal act. The POSIX adapter delivers it as the VINTR byte with ISIG on and answers with a typed refusal with ISIG off; the Windows adapter as byte 0x03 in ConPTY. The core no longer reads VINTR and ISIG itself (now `sinkOf` in `ptyLaunch.ts`). Line-discipline facts (session, foreground, echo, canonical) are not a port but a `testing` entry of the POSIX adapter: only tests read them.
- **Terminal foreground** is a fact the host answers over the wire when the adapter declared it. Adopting a CLI from the Tagma terminal on the server (`external-harnesses/adoption/shellJob.ts`, `foregroundGroup` via `ps`-stat `+`) asks the host, not `ps`.
- **Input close** is EOF for pipes, hang-up for a terminal.
- **After the leader exits, input behaves as follows.** Pipes: taken while someone holds a pipe open for reading; a `closed` refusal when no reader is left (the old host refused `exited` right after removing the leader, even with a live reader; that is fixed). Terminal: the leader is its session's leader, and on its exit the OS revokes the terminal from the whole session (on macOS — slave revoke and SIGHUP to the foreground work, as in any terminal emulator), so input answers `closed`. There is no session keeper holding the terminal past an exited leader: it would change the child's pid, session, and kinship.
- **Exit** is a code or, where the OS knows it, a signal name; cost is CPU time and peak memory.
- **Capabilities** are the set the adapter declares: named signals, interrupt and terminate for pipes, raising pace, terminal foreground, surviving holder loss. They travel over the wire next to `relations` and `transports` (`protocol/capacity.ts`), and the contract set branches on them.

### Start contract

Exactly what was passed is started — no `CommandBuilder` defaults and no leaks from the host environment:

- the child environment is exactly what was passed;
- `cwd` unset — HOME from the passed environment, else the user's home directory per OS data (on POSIX — `pw_dir` from passwd), as the old host did; neither present — a start refusal; `cwd` not a directory — a start refusal (the old one silently substituted HOME); a relative `cwd` — a start refusal: holder and logic stand in different directories and there is nothing to resolve it against;
- a program with a path starts by it; one without a path is looked up only on `PATH` of the passed environment in its `cwd`; no `PATH` — refusal. `launchNative` now takes the host's own `PATH` — that leak is fixed;
- on Windows environment names are case-insensitive (`Path`), `PATHEXT` counts, argv is assembled into a command line by MSVCRT rules, `.cmd` and `.bat` go through `cmd.exe` with its escaping; all of it is the adapter, not the core;
- the child gets no handle but its own;
- the child gets the soft limits the holder was started with, not the ones the holder raised for itself (`descriptor_room`).

### Holder: shared core and platform trait

The shared core — loop, execution table, frame protocol with the logic, logic restart policy, readiness and handover — makes no OS call. The frame protocol is shared across platforms: frames carry acts on `leader` and `work`, work identity, the terminal name when there is one, and the exit as a code or signal name. Its TS client leaves `src/posix/` for a shared holder client; the adapter keeps handle passing and their I/O. The "handles arrive no later than their frame" rule ([[9bc89024]]) holds on Windows because the holder duplicates handles into the logic process before the frame, and the frame carries their values.

The platform trait covers everything in `holder.rs`, `spawn.rs`, and `sys.rs` that now calls the OS:

- writer claim (`claim`, now `flock`);
- leaving the server session or job (`session`), preparing signals and standard handles, handle reserve (`descriptor_room`);
- logic restart clocks;
- starting the logic with a channel to it and handle passing (`rights`, now SCM_RIGHTS);
- event queue: channel ready, child exited, timer;
- starting an execution per the start contract, on a terminal or pipes, with pace;
- exit observation without removal; removal with cost;
- acts on the leader and the work; pace change;
- terminal operations that cannot be done on the logic side (resize on Windows).

The logic's native library: the `Readable`/`Writable` port stays shared, and the I/O ABI is the adapter's. POSIX — readiness and `EAGAIN` (as `execution_pty_reactor_arm` does now); Windows — completion via IOCP, with no write readiness. A logic POSIX process does not die of SIGPIPE on writing to a pipe the child closed: on macOS — `F_SETNOSIGPIPE`, on Linux — ignoring SIGPIPE in the logic process; the write answers with a typed refusal.

| | macOS (present) | Linux | Windows |
|---|---|---|---|
| events | kqueue | epoll + pidfd | completion port of the Job Object and IOCP, in one thread |
| terminal | `openpty` | `openpty` | ConPTY without `INHERIT_CURSOR` and `WIN32_INPUT_MODE` |
| start | `posix_spawn`, `CLOEXEC_DEFAULT`, `SETSID` | `posix_spawn`, `SETSID`, closing third-party fd | `CreateProcess`, `PROC_THREAD_ATTRIBUTE_HANDLE_LIST` |
| work | process group | process group | Job Object without `KILL_ON_JOB_CLOSE` |
| exit without removal | `waitid` `WNOWAIT` | `waitid(P_PIDFD)` `WNOWAIT` | process handle; closing it is the removal |
| handle passing | SCM_RIGHTS | SCM_RIGHTS | `DuplicateHandle` into the logic process |
| `low` pace | QoS utility | `nice` down; up — cgroup v2 `cpu.weight` if the holder was delegated a cgroup, otherwise up is not declared | `BELOW_NORMAL_PRIORITY_CLASS` |
| `lowest` pace | `START_SUSPENDED` + `PRIO_DARWIN_BG` (CPU and I/O) | `SCHED_IDLE` + ioprio idle; up — as for `low` | `CREATE_SUSPENDED` + `IDLE_PRIORITY_CLASS` + low I/O |
| leaving the server session | `setsid` | `setsid` | `CREATE_BREAKAWAY_FROM_JOB`; a server job forbidding breakaway means the "survives the server" capability is not declared |
| birth witness | start time from sysctl | start ticks from boot | process creation time |
| minimum OS | macOS 26 arm64 (verified) | kernel ≥ 5.4 (`pidfd_open`, `waitid(P_PIDFD)`), glibc ≥ 2.34 | Windows 10 1809+ (ConPTY) |

The Linux and Windows rows are intent, confirmed or refuted by the same contract set; a mechanism that fails it is replaced.

**Decisions for adapters already carried by the holder protocol** (found by the trait review; Linux and Windows adapters must follow them; core and protocol do not change for them):

- **Work on Windows.** The frame carries only the numeric work identity; the logic is not handed the Job Object handle. The holder creates the Job Object with a name derived from the holder's birth witness and the work identity, and the logic opens it by that name (`OpenJobObject`) for work makeup and the proven set. The witness in the name stops a repeated holder pid from opening another holder's work.
- **Child exit on Linux.** `Event::Child` is anonymous, and a leader can stand long removed while its work is not done: pidfd registers in epoll with `EPOLLONESHOT` (again after observation) or the exit is watched via `signalfd(SIGCHLD)`. A level-triggered pidfd of an unremoved child holds the loop at full CPU.
- **Writer claim on Windows.** A `LockFileEx` lock belongs to the process that took it, and its duplicate in the logic does not hold the claim after the holder dies. The logic takes its own lock so that [[48d023be|second-writer ban]] holds in orphaned logic too.
- **Terminal hang-up on Windows.** `ClosePseudoConsole` runs in the adapter thread, non-blocking for the holder loop; the pseudoconsole output is read to close by the logic, not the holder, so no byte is lost.
- **Ctrl-C with a full input queue on Linux.** The macOS adapter delivers it through `TIOCSIG`, and XNU drops input on it just as on VINTR; Linux `pty_signal` does not drop input. The Linux adapter drops input itself (`tcflush(TCIFLUSH)`) on ISIG without NOFLSH, so behavior matches the VINTR record.
- **Holder writer-claim lookup on the server** (`executions/host/boot.ts`, `stateClaim`) goes through `/usr/sbin/lsof`, which is often absent on Linux and never present on Windows: that question is answered by the server platform's adapter, not a path to a utility.

**What ConPTY does not allow**, and what follows:

- the pseudoconsole is not handed to another process and closes with its owner: on Windows a holder death ends terminals, and the "survives holder loss" capability is not declared for terminals; holder self-replacement on Windows goes only without live terminals (the boundary from [[d86d6647]]);
- `ClosePseudoConsole` can wait until the pseudoconsole output is read out: the Windows holder itself reads its output to close on hang-up, otherwise the loop stalls with no logic;
- conhost redraws output instead of forwarding bytes: byte terminal contracts on Windows are checked against the screen;
- interrupt and terminate for pipes on Windows are not delivered (Ctrl events address a console, not a Job Object, and holder children have no console): the adapter does not declare them, and the pipes ladder there is the work kill.

**An OS without an adapter.** The bundle manifest names the OS and architecture it was built for and its parts' paths by role. The server (`executions/host/boot.ts`, `raiseHost`) reconciles the OS before starting the holder and answers with a typed refusal naming the OS instead of "did not answer in N ms"; it takes the holder, library, and endpoint paths from the manifest and registry, not constants (`BUNDLE_HOLDER`, `BUNDLE_LIBRARY`, `transport: 'unix'`). A holder binary for an OS without a platform module does not build, rather than refusing at runtime (now `holder/src/main.rs:19-22`).

## Names

Every name — crate, library, ABI, module, file, type, wire field — names what it holds after this change, not what it was. A name that outlives its content is renamed by the same change that changes the content, with all consumers. Lying now:

| Now | What it really is | Becomes |
|---|---|---|
| crate `execution-pty`, `libexecution_pty.dylib`, ABI prefix `execution_pty_` | native part of the platform adapter in the logic: I/O of received handles, readiness, process table, limits, accounting; there is no pty in it | `execution-platform`, `libexecution_platform`, `execution_platform_` |
| `PtyLibrary`, `src/native/` (`Abi.ts`, `UsageAbi.ts`, `NativeUsage.ts`, `Priority.ts`) | implementations of the process-table, platform-fact, accounting, and pace ports | dissolve into the POSIX adapter by the ports they implement; there is no `PtyLibrary` type |
| `darwinProbe`, `darwinStanding`, `machineStanding.ts` | evidence and machine busyness implementations for macOS | port implementations of evidence and platform facts in the adapter's macOS module |
| `nativeLaunch.ts`, `ptyLaunch.ts`, `pipeLaunch.ts`, the `NativeExecution` type | an execution the holder keeps, on a terminal and on pipes | names for the kept execution, terminal, and pipes |
| `src/posix/` with the frame protocol inside | after step 2 — a shared holder client plus a POSIX adapter | shared client its own module; `posix` only what is POSIX |
| `group`, `tty`, `process-group`, `same-tty`, `STOP_SIGNALS` | work, terminal, stop acts | per the `Holder` port dictionary |
| `ptys` limit in capacity | number of terminals | `terminals` |

The step implementer finally picks new names by the project's naming rules; the table records that each of these names changes rather than lives on.

## What shows it works

### One contract set

The set lives as a `testing` entry of the port module and runs against any adapter. Each check asserts the contract through the port or through the host, by state, output, or typed refusal ([[4f387de2]]). The set reads adapter capabilities: where a capability is declared it checks the behavior; where not, it checks that the answer is `unsupported`. No silently skipped check.

Terminal:
- start: geometry as requested; the child is the terminal foreground (through POSIX adapter facts where they exist);
- input and output, UTF-8, a paste larger than one record chunk, a slow reader;
- large output: everything arrives whole and in order, the writer waits on a full buffer rather than losing;
- interrupt reaches the foreground work, not only the leader; with ISIG off — a typed refusal;
- resize arrives (SIGWINCH on POSIX);
- hang-up as the first stop step;
- output after the child exits is read to the end, not cut on EIO;
- input after the leader exits answers `closed` (the OS revokes the terminal from the leader's session);
- alternate screen and leaving it;
- stopping a child nobody reads from.

Pipes:
- stdin: writing, EOF on close; writing into a child that closed its stdin — a typed refusal, the logic does not die;
- stdout and stderr separately, to the end, after the child exits;
- stopping while output lies unread;
- interrupt of a program the shell did not exec — through the work;
- a program ignoring interrupt gets terminate on the second step;
- the end of an execution takes what the child forked in its work.

Shared:
- the whole start contract: environment, `cwd` and its absence, program lookup and refusals, handles, soft limits;
- an environment that cannot be passed (NUL in a value, a name with `=`) — a start refusal;
- no zombies after status removal, no live proven-set members after destroy;
- exit without removal, removal with cost, acts before removal and refusal after;
- freeing the child and exit notifications when the execution scope closed or interrupted;
- `full`, `low`, `lowest` pace for the child and what it started, and live-work pace change both ways;
- refusal to start a missing program is the same on any pace;
- capacity refusal when holder handles run out is a capacity refusal, not `os`;
- executions survive logic restart and holder loss where the capability is declared (behavior from [[d86d6647]]).

The set carries over all kept contracts of the removed `src/native/Pty.itest.ts` and `src/PipeProcess.itest.ts` (HEAD before [[0308b97d]]): child freeing, notifier and handle on scope interrupt; kind refusals (with the new `exited`/`closed` meaning above); refusal of an environment that cannot be packed; stopping a child with unread output; refusal to write to a closed stdin instead of dying of a broken pipe; freeing exit notifications; interrupt through the group; terminate on the second step; a child's end with its forks.

### On macOS no worse than before, better where the old one was wrong

- The old build no longer starts: the contract set and measurements run only on the new implementation.
- The host integration tests that passed before the holder (`ExecutionTerminal`, `terminalRelease`, `managedShell`, `PipelineDeath`, `UnwatchableExit`, `CommandDeadline`, `CommandLifetime`, `CommandInventory`, and the rest in `packages/execution-host/src`) pass on the new implementation; composition changes. An assertion changes only in three cases, each named in the diff against the commit before [[e946bdd8]]:
  - steps and remainder relations renamed by the dictionary: `SIGHUP` → `hang-up`, `SIGINT` → `interrupt`, `SIGTERM` → `terminate`, `SIGKILL` → `kill`, `process-group` → work, `same-tty` → terminal; step order, deadlines, cleanup, and `NativeExit.Signal` are checked as before;
  - the assertion pinned a contract violation — with the named contract;
  - behavior is intentionally changed by [[d86d6647]]: logic death does not end executions (the `hostExit` test "leaves on a signal while it holds a live pty" is replaced by a holder-loss test), holder loss closes new starts, logic that left before ready does not restart.
- Measurements of the new build: big-output throughput over PTY, PTY input echo delay, stdout and stdin throughput over pipes (now reading in chunks through the shared readiness stream). Already recorded numbers of the old build are a landmark; a divergence from them is investigated in the new one; each result is one sample and reported as a sample ([[fe83acfa]]).
- `holder.itest` with a real binary, as now.

### Where it is proven

- **macOS** — the implementer, on their host in their state catalog. The only OS on which the line runs anything.
- **Linux and Windows** — no machines at hand, and nothing runs on them in this line. The line proves only that they fit as adapters: the core, ports, wire, and holder protocol know no OS, and the contract set branches on capabilities. While there is no adapter, the host on those OSes answers with a server OS refusal, not unverified code.

**Checked by the operator** (not a task completion condition): ordinary work on macOS — vim, ssh, a dev server, a Claude Code thread in the Tagma terminal — is no worse than before the line.

## Order

1. **Ports and wire without an OS.** Neutral stop acts, work identity, and terminal operations into the Holder port and shared wire; remainder relations, capabilities, terminal interrupt, work identity, platform facts, pace, endpoint and credentials, program lookup — all behind ports; composition its own module; the core imports no adapter. Step merges with the unfinished [[0308b97d]] in one agreed change of the same declarations, not two rewrites in a row.
2. **Holder and native library.** Shared core, shared frame protocol and its shared TS client, the platform trait with a macOS module; a manifest with the OS and part paths; OS reconciliation on the server.
3. **The contract set and carrying over removed contracts; parity and measurements on macOS.** Falls in `nativeLaunch.itest` close here.
Steps 1–3 enter the [[d86d6647]] line and stand before the host handover and recovery step: nothing lands in main without them ([[7c1b6811]]). The POSIX adapter's Linux module and the Windows adapter (modeled on portable-pty's ConPTY part) are not in the line: they are written when a machine appears on which the set can run.
