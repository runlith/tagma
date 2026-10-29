---
id: 01a126fe-f36e-7a6c-a92e-1ade69cf3796
title: "Updating the execution host without finishing processes: raw exec, state transfer and guarantee boundaries"
ord: 3
tags: ["research"]
fields:
  {
    "source": {
      "name": "POSIX.1-2024 and Apple/Microsoft documents; a live Bun 1.4.2 probe on macOS 26.0.1 arm64",
      "ref": "https://pubs.opengroup.org/onlinepubs/9799919799/functions/exec.html; ~/.tagma/scratch/01a126ef-e62c-7eb7-b9d7-56c05ae5a2ef/; runlith e7aa806a1179bf2f21ac23c7d6ec299e6a45bc5a"
    }
  }
---
The execution host program can be updated while keeping live processes, PTYs and pipes if its image is replaced through raw `exec` and owner state is transferred. On macOS arm64 this is proven between two Bun bundles. The promise "no program ever notices anything, under any failure, on every platform" is stronger than proven: there is an I/O service gap, finite kernel queues and the irreversible boundary of a successful `exec`.

## Observations: conditions and sources

The research was done on October 10, 2026. Machine: macOS 26.0.1, build 25A362, arm64; Bun 1.4.2, revision `744846f844374847c902b5e7fd59b4342a51ef99`; rustc 1.96.0 (`ac68faa20`, 2026-05-25); Apple clang 17.0.0 (`clang-1700.3.19.1`). The prototype was built with clang, native calls go through `bun:ffi`; Rust was not used in the probe. This install's `process.execPath` sits in a Homebrew directory named 1.3.7: the directory number was not used as evidence about the running binary. Effect was read in `.external/effect` at tag `effect@4.0.1`. The native host uses portable-pty 0.9.0 (`packages/execution-host/native/Cargo.toml:14–16`).

The runlith code was read in the canonical checkout `/opt/workspaces/runlith`; while the main area was read HEAD was `e7aa806a1179bf2f21ac23c7d6ec299e6a45bc5a`; during the research HEAD moved to `fcbdc321305cf7355b62aabc7cba75233426c3b2`. The lines quoted below witness the working tree as read, not a promise that the lines stand still after later edits. The session did not modify the checkout; `read_changes` answered that it holds 0 paths. The working server and its execution host were never started, stopped, or given probe commands.

Primary OS documents:

- [POSIX.1-2024 exec](https://pubs.opengroup.org/onlinepubs/9799919799/functions/exec.html): inheritable fds, PID, PPID, process group, session and controlling terminal; destruction of old memory and all threads with no cleanup handlers; reset of caught signals; removal of POSIX timers.
- [Apple execve(2)](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/execve.2.html): the same guarantee for open fds without close-on-exec and process identity. This is an archived man page; current behaviour was additionally measured on macOS 26.0.1.
- [POSIX wait/waitpid](https://pubs.opengroup.org/onlinepubs/9799919799/functions/waitpid.html): status belongs to the immediate parent, `ECHILD` for another's PID; collecting status consumes it.
- [POSIX recvmsg](https://pubs.opengroup.org/onlinepubs/9799919799/functions/recvmsg.html): `SCM_RIGHTS` copies descriptors into the receiving process.
- [POSIX kill](https://pubs.opengroup.org/onlinepubs/9799919799/functions/kill.html): signal access is set by credentials, not parenthood; a negative PID selects the group.
- [POSIX write](https://pubs.opengroup.org/onlinepubs/9799919799/functions/write.html): a full blocking pipe stalls the writer; nonblocking answers `EAGAIN` or a partial write; no reader gives `EPIPE` and `SIGPIPE`.
- [POSIX terminal interface](https://pubs.opengroup.org/onlinepubs/9799919799/basedefs/V1_chap11.html): the controlling terminal belongs to the session, the kernel holds the foreground group; VINTR and VSUSP address the foreground group; the input queue is finite, over-limit behaviour is platform-defined.
- [Microsoft DuplicateHandle](https://learn.microsoft.com/en-us/windows/win32/api/handleapi/nf-handleapi-duplicatehandle), [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects), [ClosePseudoConsole](https://learn.microsoft.com/en-us/windows/console/closepseudoconsole), [ReleasePseudoConsole](https://learn.microsoft.com/en-us/windows/console/releasepseudoconsole), [CRT _execve](https://learn.microsoft.com/en-us/cpp/c-runtime-library/reference/execve-wexecve?view=msvc-170): a different HANDLE and ConPTY model, and the CRT starts a new process.

## Observations: the current replacement and host state

The current mechanism genuinely finishes live executions before shutdown and a new boot: `apps/tagma/server/src/executions/host/replacement.ts:120–146,256–267`. With `when-idle` live executions postpone replacement; that never guarantees the host empties one day. When the live host cannot be talked to, the new server leaves it, and terminals refuse: `preflight.ts:57–93`. `boot.ts:210–216` has `Bun.spawn` and `unref` but no `detached`. The server/host split alone is not yet independence from the system supervisor's process-group completion rules.

Foreign CLIs go through the same resource owner: `apps/tagma/server/src/external-harnesses/sessions/launch.ts:92–102` starts a held PTY; `external-harnesses/protocol/link.ts:46–55` starts held pipes. Keeping their processes needs no separate technology; keeping their protocol needs whole input frames and saved receipts. `protocol/link.ts:84–108,148–161` treats a lost input answer as unknown, and gap/lost output as the end of normal reading.

| Resource | Where it sits now | What an image change gives and what is still missing |
| --- | --- | --- |
| Child processes, groups, session and exit status | Life and kinship are the kernel's. The native PTY holds a userspace `Child`, PID, exit and usage: `native/src/pty.rs:59–74,153–179`. On macOS pipes start through `posix_spawn`, status is read through `waitid`/`wait4`: `src/native/PipeChild.ts:105–177,215–262`. | Raw exec keeps kinship. Children need no re-adoption: the new image of the same PID calls `waitpid`/`wait4` on the saved PID again. Already consumed status/usage must be carried over; lost userspace status cannot be got from the kernel again. PID and start witness cannot be restored from the command line. |
| PTY master and its reader | Two userspace fd owners in Rust: `native/src/pty.rs:59–61,85–96,122–123`; JavaScript holds the pointer, landing buffer, callback and waiters: `src/native/Pty.ts:70–97`. The ABI offers open/read/wait/close but no resource import/export: `src/native/Abi.ts:12–43`. | The fd itself can be inherited once `FD_CLOEXEC` is off; the pointer, Rust Box and trait objects cannot. What is needed is a native import of the inherited master fd, PID and tty facts. That is use of the already open master, not reopening the slave by name and not a new `openpty`. The old address is invalid after exec. |
| stdout/stderr/stdin pipes | On macOS fd numbers hide in the closure, fds are marked close-on-exec, reading and writing wrap Bun stream/FileSink: `src/native/PipeChild.ts:124–145,183–195,278–296`. Other platforms use `Bun.spawn`: lines 19–68,105–106. | The fds must be exported, close-on-exec lifted only on held resources, Bun's already-read queues drained/carried plus partially written input, then new readers/writers built. `Bun.Subprocess` itself never restores by PID. On macOS the current native launcher is already closer to that goal than `Bun.spawn`. |
| Readiness, callbacks and threads | Rust holds kqueue, function pointer, atomic state and thread: `native/src/readiness.rs:14–20,52–109`; queue close-on-exec: line 66. | All of that is recreated. Before the handover the native reader stops reading and stops callbacks, keeping the master. The current `Pty.close` finalizes the notifier and closes master aliases together (`native/src/pty.rs:288–300`), so the regular close does not fit handover. |
| Screen and interpreter | `@xterm/headless` Terminal, parsed offset, pending replies, StringGuard, appearance/input modes — memory: `src/Interpretation.ts:38–54,76–118,140–175,291–326`. `ScreenMirror` holds the projection and reuse-state: `src/ScreenMirror.ts:150–161`. | Either a full engine-state export or proven reproduction from a sufficient checkpoint is needed. A cell picture never replaces parser state: normal/alternate buffers, saved cursor, tabs, margins, modes, current attributes, decoder/unfinished ESC/OSC/DCS and pending replies are needed. Plain replay must not answer historic terminal queries a second time. The `Interpretation.ts` as read has no full-Terminal restore entry. |
| Output and its positions | Bytes go to file segments (`src/RecordWriter.ts:85–139`), but frontiers, CRC, grid history and open handles sit in `Ref` (`src/ExecutionRecord.ts:122–142,183–202`). Retention deletes old segments: lines 465–493. Seal is written separately: lines 336–377. Sync runs at segment close (`src/RecordWriter.ts:160–183`), not on every append. | Written bytes survive exec and read after reopen. That is not yet a live checkpoint: frontier/CRC/grid, the disk-vs-userspace boundary must move over, and the current segment must continue without `wx`-recreation. All historic output may already be deleted, so screen restore from the start cannot be promised. A file's presence never proves survival past a power cut. |
| Timers and deadlines | Call map, acquired/expiry instants, Deferred and timer fiber — memory: `src/CallLifetimes.ts:17–40,82–84,133–146,239–260`. Budget/decisions/revisions are written to SQLite (`src/db/schema.ts:209–268`), but `persist` does not write every runtime instant (`src/CallLifetimes.ts:343–350`). Program-rule due times and lineage are also in memory (`src/ProgramRules.ts:51–66,110–124,162–167`). | The timer fiber is recreated for the old deadline, including elapsed transition time. Bun clocks reset at exec: a separate probe below. The current bigint instant cannot be carried over literally. A shared kernel clock and explicit sleep/reboot semantics are needed, or a recount on the new origin; a program-rule timeout must never restart. |
| Custody, lanes, operations | Execution custody and host custody are written in SQLite: `src/db/schema.ts:56–66,122–149`; `ExecutionCustody.open` reads custody from the store: `src/ExecutionCustody.ts:46–53`. Bindings and input receipts/pending queue are memory: `src/Bindings.ts:70–75`; `src/ExecutionInput.ts:82–98,119–140`. Live registry and queues are `src/registry/state.ts:43–54,129–142`. | Custody recovers; bindings, sequence/frontiers, taken bytes and receipts belong in the checkpoint. Disk operation receipts alone never decide exactly-once delivery of already taken stdin. The move never transfers custody to another principal. A lane stays bound to its old execution, and the lane ends on a genuine custody move. |
| Server connection | Unix socket and userspace framing, in-flight requests, subscriptions, credits: `src/HostConnections.ts:193–215,231–234`; subscriptions carry a byte cursor or screen base: `src/subscriptions.ts:38–54,110–139`. | A raw socket fd can be inherited, but the old parser, half-written frames and promises never survive exec. The practical path is managed reconnection with the old identities and cursors; the other path is full stream/framing-state transfer. That hides the break from UI/CLI, not preserves the TCP/Unix connection object itself. |
| SQLite and writer claim | Its own `executions.sqlite`: `src/host.ts:75–76,168–180`. Claim is File + flock + `O_CLOEXEC`: `native/src/identity.rs:43–67`. The store bumps incarnation on every open: `src/store/ExecutionStore.ts:328–350`, then rejects old refs: lines 380–386. | The open path needs a separate resume: keep live identities and never turn a program update into an execution-generation end. Transactions finish, connection/statement pointers close and the DB reopens; the claim fd is imported with no gap where it stands free. A flock-holding fd must never be bypassed by a repeated `Claim.take`. |

The current output pipeline order is kernel/Bun read → append record → interpretation → presentation: `src/registry/work.ts:36–63`. So quiescence must also pin the chunk between reading and append, not just close file writing.

## Observations: the live probe

The prototype and results are kept in scratch `~/.tagma/scratch/01a126ef-e62c-7eb7-b9d7-56c05ae5a2ef/`. That is neither a checkout nor a working Tagma host. Files: `probe.c`, `probe.dylib`, `child`, `host.ts`, `host-a.ts`, `host-b.ts`, `host-a.bundle.js`, `host-b.bundle.js`, `bun-execve.ts`, `clock.ts`, `scm.c`, `scm-probe`; results `result-normal.json`, `result-delayed.json`, `result-bundles.json`, `bun-execve-result.json`, `clock-result.json`, `scm-result.json`, `state.json`, five output logs. The thread holds the scratch; once the thread is deleted, the prototype's survival outside it is not promised. The records suffice to restore the probe command, but its raw logs will need the saved scratch.

Build: `clang -O2 -DLIBRARY -dynamiclib probe.c -o probe.dylib`, `clang -O2 probe.c -o child`; then `bun build host-a.ts --target=bun --outfile=host-a.bundle.js` and likewise for `host-b.ts`. Main check run: `PROBE_SUCCESSOR=host-b.bundle.js bun host-a.bundle.js`. No delegation; the host starts three immediate children. After the pipes-child finishes, a separate job-control check starts one sleep, so no more than three spawned processes remain at once.

The first bundle holds an interactive `/bin/bash --noprofile --norc -i` over a real PTY, a dev-server over pipes with a TCP listener on loopback and a 100 ms counter, a third child over stdin/stdout/stderr pipes with a 100 ms counter. Native code calls raw libc `execv` of another Bun bundle. fds move to the 200+ range, close-on-exec is off; numbers, PIDs and minimal state are written before exec. The new bundle keeps reading and writing the same fds, and `waitpid` is called from the new image.

Results between the built bundles:

| Measurement | Fact |
| --- | --- |
| Host PID | 98062 → 98062 |
| PTY shell / dev-server / pipes-child PIDs | 98067 / 98068 / 98069; all three alive before and after exec, nothing starts in their place |
| Gap from last drain to first new drain | 42.317 ms; 39.373 ms from the exec-timestamp write to the ready new image |
| Counter bytes | dev stdout 186; pipes stdout 180; pipes stderr 180; PTY counter 560 bytes, including NL→CRLF conversion |
| Counter-byte loss / repeat | 0 / 0 for each of the four checked sequences |
| PTY input | The command written before the handover gave `GAP_PTY`; the new image entered a command and read the same shell PID's answer |
| Terminal facts | PGID = SID = foreground PGID = 98067 before and after; 103×31 size and local flags 1219, VINTR=3, VSUSP=26 kept |
| Job control after handover | Sleep got its own foreground group 98128; Ctrl-Z stopped the job, `jobs -l` showed it, `fg` resumed, Ctrl-C finished it; the shell then ran `JOB_OK` |
| Resize after handover | TIOCSWINSZ gave 117×42, read back |
| Handover SIGHUP | The shell trap saw no SIGHUP; dev/pipes recorded no signal before their orderly stop |
| Dev port | 50556 answered `pid=98068,count=6` after handover; the listener was not recreated |
| Exit status after handover | `waitpid(98069)` returned raw 9472, code 37; a child that finished about 2.4 s after the handover |
| Cleanup | All three direct children reaped; dev stopped by SIGTERM, the shell exited `exit 0`; the check `ps` found no probe PIDs |

A plain TS run gave a 43.574 ms gap. A separate `PROBE_DELAY_MS=250 bun host-a.ts` run deliberately held the new image 250 ms before reading: a 277.804 ms gap. The dev-server printed D0007 and D0008 in that window, after it the TCP answer carried `count=8`; those bytes and the pipes bytes arrived with no loss and no duplicates. This is a light-load sample, not an upper bound for the product or a slow machine. The byte audit checks full counter-record sequences; it claims no separate reference for every prompt/echo byte of the interactive shell.

### What works in Bun and what breaks

`process.execve` exists in Bun 1.4.2 but **does not fit this transfer**. In `bun-execve.ts` a regular-file fd was moved to 200 with close-on-exec off. After `process.execve` the PID stayed 89541, but `read(200)` answered `-9`, i.e. `EBADF`. That is a single-process control with no running children. Raw libc `execv` through FFI in the main probe kept all held fds alive. So one Bun API call plus the flag is not enough: a native operation that never closes carrier descriptors is needed. [The Node process.execve document](https://nodejs.org/api/process.html#processexecvefile-args-env) also describes keeping only the standard descriptors; the Bun conclusion here comes from the probe, not carried over from Node.

The clocks disagree too. In `clock.ts` on one PID 4622 after raw exec `process.hrtime.bigint()` changed from 175130167 to 5743791 ns, `performance.now()` from 175.124 to 5.741 ms; native `CLOCK_MONOTONIC` advanced 14.084 ms. Effect 4.0.1 picks `process.hrtime.bigint()` ahead of the performance fallback (`packages/effect/src/internal/effect.ts:6333–6337` at the read tag). Current host deadlines depend on that origin; the checkpoint must carry them over, keeping the transition time.

### What SCM_RIGHTS carries

A separate native probe `clang -O2 scm.c -o scm-probe && ./scm-probe`: the source parent created counter-child 98096, and successor 98097 got its output fd through a Unix socket/SCM_RIGHTS. The child stayed alive, the successor read all 17 bytes of `COUNTER_SURVIVED`, the `kill(-98096,0)` permission probe passed. But the successor's `waitpid(98096,WNOHANG)` answered `-1`, errno 10 (`ECHILD`). The source parent got code 37, then awaited the successor. fd transfer carried no parenthood and no right to collect the exit status.

## Conclusions: update paths

### A. Raw exec of the same owner — the best direct path for macOS

The new image is the same kernel process. The child keeps seeing the old PPID, its PID, fds, process group, session, terminal line discipline and size. No adoption is needed; userspace wrappers over the already held fds and parenthood are restored. The native PTY API needs an export/import addition, and the pipes launcher open ownership of carrier fds plus exact read/written boundaries. Bun runtime threads and Rust readiness threads end under exec rules; their callbacks, event-loop handles and fibers are recreated. The host's ordinary close/finalizers must not be used: right now they stop children and close the master (`src/native/Pty.ts:430–452`, `src/PipeProcess.ts:88–99`).

Programs get no HUP/INT/TERM and no new PTY is created. While the new image serves no I/O, bytes accumulate in the kernel. When the queue is full a blocking writer stalls; a nonblocking writer can see `EAGAIN`. The terminal input queue can have its own overflow behaviour. Host answers to terminal queries also arrive late. Input already written to PTY/pipes stays in the kernel; input taken in JS but not yet written belongs in the checkpoint; input that reached server/UI in the transition window waits in a durable queue with the old operation/sequence ids. Keeping kernel fds never yields such a queue for free.

A successful exec is irreversible for the old memory. Before the call, preparation errors and an ordinary `exec` refusal let the old host continue: probing a missing binary returned errno 2 (`ENOENT`), all three children stayed alive. After a successful exec a new reader's logic refusal can only be handled while the new process lives and holds the fds: by re-exec of the working image or by fixing/migrating the checkpoint. If the new image dies at once, the fds' only owner is gone; the terminal can get a hangup, the pipe EOF/EPIPE, parenthood leaves. An outside watcher with no pre-held resources never restores master and wait status from SQLite. An arbitrary fatal crash after exec is outside this design.

The gap covers drain/checkpoint, new-build verification, the native transition, Bun start, store reopen and Terminal restore. The prototype's 42.317 ms never measures a full host with many screens and data. Previewing the new reader/migration before the handover lowers risk but never proves no crash after it.

### B. SCM_RIGHTS to a successor — not enough without a kept parent

fds, kernel queues and the PTY session can stay. The new reader must consume output alone: two readers get no two copies, they split bytes. The new input queue likewise needs one writer and carried receipts. The handover can be prepared ahead, keeping the old owner until the new one confirms; that protocol's duration was never measured.

Losing parenthood means losing `waitpid`/`wait4`, exit status and final rusage at the successor; established by probe. PID/group signals **are not lost automatically**: permissions are set by credentials, confirmed by `kill(-pgid,0)`. The shell's controlling terminal is likewise no host-parent property: it belongs to the shell session, and the new host writes to the same master. When the source parent exits the PPID changes; orphaned stopped process groups and closing the last master must also be ruled out. These conditions differ from exec, which keeps the old parent's PID.

On macOS a plain fd transfer cannot arbitrarily make the successor the existing children's parent. Leaving the old parent to wait and report exit is already a permanent resource holder. A Linux subreaper takes orphaned descendants at the nearest **ancestor**, never turns an arbitrary sibling/child successor into a parent; [the PR_SET_CHILD_SUBREAPER description](https://man7.org/linux/man-pages/man2/pr_set_child_subreaper.2const.html). Cancelling the transfer before the old owner leaves is achievable; after its death the original wait guarantees cannot be returned by this transfer.

### C. A small native resource holder — the best boundary for replaceable-logic resilience

One holder starts children, holds PTY/pipe/ConPTY, wait status, ingress/egress frontiers and the needed queue. Screen Bun logic, server wire, policies and views change independently. This differs from the current server/host split in the crash-boundary place: one Bun memory now holds the changing logic, the last master and the children's parent together. With a separate native holder a new Bun worker's error never closes terminals and lets the previous working logic reconnect.

For the child to feel no pause from the worker change, the holder must keep draining/spooling output and taking/ordering input. The sender gets receipts from the continuous owner; the worker catches up on bytes by offsets, the UI keeps the old screen until the new projection. No SIGHUP is sent, grid/job control stay in the OS. When the spool/disk fills or the holder is gone the promise still bounds; endless output with an endlessly idle reader is outside this design.

This genuinely moves the last owner's update problem one level down. If the holder is never replaced with live children, it cannot be honestly said that the **whole** host updates on every release. On Unix the holder itself can update through raw exec with a far smaller checkpoint, but its new image's fatal crash is still critical. Genuine holder-level rollback needs a resource-keeping live owner/special transfer, not a supervisor restart. This variant was never proven by a live probe; its win is an ownership-boundary inference, not a measured implementation.

### D. Swapping the JS worker inside a live native owner

If the resource owner's program stays alive, the computing part can be swapped as a worker and checked before publishing. That is shape C, not another way to transfer parenthood. It covers frequent logic updates, but never by itself the Bun runtime or the native holder update. A tmux/dtach-like separate keeper per execution and keeping old hosts for old children share the same lower problem; keeping the old host until the session ends never answers the original demand to update the host together with the server.

## Conclusions: the state shape and one current code shape

A genuine input format appears between images, even unnumbered: identities and native witnesses; the inherited fd/handle → execution/stream map; already-reaped status/rusage; queues, partial writes and input receipts; record offsets/CRC/grid; a full terminal-parser checkpoint; custody/bindings; absolute deadlines; unfinished operations, queued launches and stop phase; endpoint/request/subscription frontiers. An fd number is only an address inside the process; it needs a meaningful binding. Deleted strings, pointers, scopes, promises and function addresses never enter it.

This needs no two working readers. One current reader plus a one-time migration of the saved checkpoint/DB when the shape changes, within the migrations the rule allows, agrees with the [[acb620dd|one current shape]] rule; imported state must be brought to the current shape before resume. The previous running program's export and the new program physically coexist at update time: banning two shapes in sources never removes that boundary. Part of the update mechanism must either carry a stable input meaning or be able to migrate the concretely found state. If any such migration is banned while the input can change freely, the seamless-update demand is unachievable.

Running the old image back after an irreversible migration is no general rollback. Its reader may not read the new store, and accepted input and new bytes can never be unwritten. Before the handover a working image and a reversible checkpoint can be saved; after new work starts rollback is allowed only with the readability of its state proven. Neither automatically finishing all children, nor refusing terminals, nor vaguely rewriting stdin counts as success.

## Conclusions: platforms and the user

**macOS arm64.** The probe proved raw exec for Bun 1.4.2 with a real PTY, TCP listener and pipes. The current Rust/native adapter is macOS-only (`native/src/lib.rs:11–20`, `src/native/PtyLibrary.ts:93–98`); the real host has no live-state keeping mechanism yet. Launchd supervision needs a separate process-group-lifetime decision: `unref` never does `setsid`.

**Linux.** The POSIX exec/fd/parenthood mechanism is the same by document; a Linux adapter for PTY/process witness/ready events/accounting and a separate runtime qualification are needed. Darwin kqueue/sysctl/libproc give way to Linux facilities; `wait4.ru_maxrss` has a different unit, already noted by `native/src/pty.rs:37–42`. Linux `PR_SET_PDEATHSIG` binds to the child-creating **thread**, and exec ends other threads: no such child's safety can be promised without checking the launch thread and exec; [the PR_SET_PDEATHSIG description](https://man.archlinux.org/man/PR_SET_PDEATHSIG.2const.en). There is no live Linux probe here.

**Windows.** Unix raw exec with the same PID/kinship is no Windows mechanism: CRT `_execve` creates a new process. A process HANDLE can be passed and the exit code collected without being a POSIX parent; pipe and Job HANDLEs duplicate too. A Job with `KILL_ON_JOB_CLOSE` cannot be left without its last handle at transfer. ConPTY `HPCON` cannot be treated as an ordinary transferable kernel HANDLE by its name alone: the public API as read promises no such transfer; `ClosePseudoConsole` sends `CTRL_CLOSE_EVENT` to attached applications. On Windows 11 24H2 there is `ReleasePseudoConsole`, letting a session live until clients leave, but that is no HPCON-import API for a new host and yields no new resize owner. A stable ConPTY holder is a reasonable candidate, not the one proven possibility. There is no live Windows probe.

The product kernel must demand execution continuation, identities, bytes, deadlines and the handover result through its contract. Darwin exec, Linux exec and Windows HANDLE/ConPTY lifetime belong to platform adapters behind that contract; the kernel must never enumerate OSs or branch on them.

For a public-build user a separate host is no action: updating automatically prepares and hands over, keeps execution references, input queue, stdout history and the screen, and surfaces resume reading. A short response lag is possible; the host's existence and any command to finish it by hand are unneeded by the normal update flow. But literal invisibility to every program is unachievable: a program can observe a terminal-query lag, output-queue fill or its parent's image change.

Large parts of the needed engineering: native resource resume; quiescent checkpoint owners and Terminal transfer; an exactly defined input/output and receipt boundary; continuous clocks/deadlines; store opening that keeps live identities; automatic agreed server/host change and consumer reconnection; separate platform adapters and failure qualification. A holder below it helps cover the swappable Bun logic's failures; the current probe gives no ground to promise covering the very last owner's failure.

## Proven and still open

Proven on this machine: raw native exec works between Bun bundles with no PID change for host/three children; fds, terminal session/grid/job control, input, TCP listener and the right to wait on a child persist; counters are neither lost nor repeated; kernel buffering survived a deliberate 277.804 ms gap; an early `ENOENT` lets the old image stay; Bun `process.execve` loses fd 200; Bun runtime clocks reset; SCM_RIGHTS keeps fds but carries no parenthood.

Not verified: real ExecutionRegistry/SQLite handover, full xterm-state transfer, Bun read-ahead under load, all partial-write/receipt crash windows, a large install's lag cap, actual Claude Code/Devin protocols, fault/kill of the new image after successful exec, a continuous TCP connection to the server, launchd behaviour, Linux and Windows. The probe used light homegrown children; that evidences the mechanism's feasibility, not the current host's readiness and no general guarantee for arbitrary CLIs. All probe processes are finished.
