---
id: 01a1271e-2479-7971-9b0c-4ec5d86d6647
title: The execution host updates with the server without ending a single process
ord: 10
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a126fe-f36e-7a6c-a92e-1ade69cf3796
sources:
  - kind: dir
    ref: packages/execution-host/native
  - kind: file
    ref: apps/tagma/server/src/executions/host/activation.ts
  - kind: file
    ref: apps/tagma/server/src/executions/host/boot.ts
  - kind: file
    ref: apps/tagma/server/src/executions/host/offer.ts
  - kind: file
    ref: packages/execution-host/src/CallLifetimes.ts
  - kind: file
    ref: packages/execution-host/src/ExecutionRecord.ts
  - kind: file
    ref: packages/execution-host/src/host.ts
  - kind: file
    ref: packages/execution-host/src/Interpretation.ts
  - kind: file
    ref: packages/execution-host/src/registry/assembly.ts
  - kind: file
    ref: packages/execution-host/src/registry/shutdown.ts
  - kind: file
    ref: packages/execution-host/src/store/ExecutionStore.ts
  - kind: file
    ref: packages/executions/src/protocol/artifact.ts
---
A Tagma update swaps the execution host together with the server, and not one process the host holds ends: the same pid, the same PTY, the same pipes and port, output with no loss and no repeats, input works. The user knows nothing of the host and does nothing for it. To that end the host is split into two processes: a small Rust **holder** — the parent of all executions and the owner of their fd — and the Bun **logic**. The logic changes with every new host build and after a swap restores itself from the holder table, its own store, record files, and the screen checkpoint.

## What the user gets

- An update does not ask about terminals and is not postponed because of them. After the restart window ([[5f9b619e|root]]) the person sees the same terminals with the same screen and history. Output printed in the window appears at once; the dev server answers on the same port; the agent's background command lives to its old deadline. A foreign CLI gets every frame the host took before the swap whole and once, and the server reads its output on from the old record cursor.
- A restart where the host bundle and its load entry did not change does not touch the host at all.
- The server never talks to a host of another build, so wire compatibility checks and all their roads disappear.
- An agent command taken into the queue but not yet started ends on swap with "not started", and the agent starts it again, as after any host restart.

## What the executed program sees

- pid, parent (the holder pid), session, process group, controlling terminal, window size, and line-discipline modes stay the same. The swap sends no SIGHUP, no SIGWINCH, no SIGPIPE.
- Output in the gap lands in the kernel buffer. When the buffer is full the program's write waits (a blocking fd) or gets EAGAIN: the pause is no longer than the gap, nothing is lost or repeated, order is kept.
- There is no input in the gap: nobody can send it during the restart window. Accepted but not yet written input is written first by the new logic, from the byte where the old one stopped.
- A terminal query (DSR, DA, colors) asked in the gap is answered after the gap; an answer the old logic already produced but had no time to write arrives exactly once.
- A child exit observed in the gap is watched by the holder without removal; the new logic gets its exit code and rusage from it.

The spec does not promise absolute unnoticeability: a program can notice the output pause and the late query answer.

## Decision: holder and replaceable logic

### What in the host is restorable, and what lives only in memory

| State | Now | What the swap needs |
|---|---|---|
| Children, their kinship, PTY and pipes fd | the fd's only owner and parent is the host process (`native/src/pty.rs`, `src/native/PipeChild.ts`) | a holder that does not leave on a logic swap |
| Executions, custody, operation keys, stop intent, call revisions and decisions | `executions.sqlite` | already restorable, but every store open starts a new generation (`store/ExecutionStore.ts:332-352`), and the old generation's refs get a refusal (`:380-387`, `generation.ts:27-39`): the generation must continue |
| Output bytes | segment files | already restorable; segment boundaries, their checksums, and grid changes live only in memory until seal (`ExecutionRecord.ts`, `StreamState`) |
| Screen and parser | `@xterm/headless` in memory (`Interpretation.ts:38-54`) | not restorable from the record: retention (`limits.output.retainedBytes`) evicts early bytes, and with them the modes the program enabled at start |
| Call deadline | `CallLifetimes` on process clocks (`CallLifetimes.ts:133-146`); `persist` does not write instants (`:343-351`) | shared clocks and a saved instant |
| `call` and `paced` budget | only in the in-memory `LaunchRequest` (`registry/assembly.ts:37-42,143-146`) | save at start: without them there is nothing to assemble a running execution's owners from |
| Program rule deadline | `dueMs` from monotonic `ProcessWatch` (`ProgramRules.ts:166`, `ProcessWatch.ts:6`) | shared clocks and a saved deadline |
| Proven set | memory; a descendant whose parent left is held only by remembered membership (`ProvenSet.ts:148-211`) | everything but such descendants derives from the process table |
| Execution pace | `Pacing` in memory | save |
| Input: queue, the record act, the partial-write offset | the act leaves `pending` before writing (`ExecutionInput.ts:395-408`), the partial-write offset is a local variable (`native/Pty.ts:139-165`) | the exact writer boundary (see "Swap") |
| Answers to queries | `Interpretation`'s own queue and a separate delivery fiber (`Interpretation.ts:291-341`) | drain into the input queue before the writer boundary |
| Taken but unstarted commands | `LaunchRequest` only in in-memory `Accepted` (`registry/launch.ts:174-192`); the environment in the fingerprint is only a hash (`registry/fingerprint.ts:46-54`) | not carried: they end with "not started" (`registry/launch.ts:171`) |
| Input lanes and receipts | memory (`Bindings.ts:70-74`, `ExecutionInput.ts:82-98`) | unneeded: they live within a custody epoch (`ExecutionInput.ts:156-169`), and server custody ends with its connection (`HostConnections.ts:570-589`) — so on every server restart already |
| Subscriptions, viewer frames, connections | memory | unneeded: the server reconnects and opens them again |

What must be carried is not the host's whole userspace state but a small set of facts: generation continuation, pre-seal record accounting, the screen, deadlines on shared clocks, budget and pace, remembered descendants, and the input remainder.

### Why the holder

**(A) Exec of the whole host with a checkpoint of all memory — rejected.** Every in-memory structure — queues, receipts, lanes, deadline fibers, proven sets, presentation, subscriptions — would become a format between builds: the next build must read the previous one's memory, and any edit to such a structure is a migration. That is directly against [[acb620dd|one current form]], and the table above shows almost none of it needs carrying.

**(A′) Exec of the whole host, but with recovery from the store as below — rejected.** The recovery work is the same as in the picked variant; the only saving is the holder. The price is reliability. The last fd owner stays a Bun image with the whole runtime, Effect, SQLite, xterm, and host logic: an image fall after exec or a host fall at any other moment closes all PTYs and pipes, as now. There is no such exec on Windows at all.

**(B) Holder and replaceable logic — picked.** The holder is a single-threaded Rust process. It starts children, holds their fd, watches their exits, hands fd copies to the logic, and starts the logic itself. It does not read child output, parses nothing the child writes, and keeps no deadlines. The logic is the current host minus process starting: it gets fd copies over SCM_RIGHTS and does all I/O itself. Kinship stays with the holder, so the [[69cf3796|probe]] `ECHILD` does not occur. A logic swap is one process leaving and another arriving with the holder alive; a logic fall is the same road without preparation. The holder changes its own bytes by exec with a small table, and only when its own file changed.

Also rejected: handing fd to a successor without a holder — kinship and exit status are lost; leaving the old host to serve its children — a host with live work then never changes, and that is exactly the hole this spec closes.

A live probe of the prototype ([[69cf3796|study]], the holder probe report) confirmed on macOS 26 arm64: on logic swap and holder exec, pid, parent, session, group, foreground, window size persist, with no SIGHUP, SIGPIPE, or EOF; a child exit with no logic is taken with code and rusage; a DSR printed with no logic got its answer after it.

## Arrangement

| Process | Owns | When it changes |
|---|---|---|
| Holder (Rust; one per host state catalog; its own session) | writer claim; PTY master and parent ends of child stdio; child kinship, exit observation, and status removal; the logic process; permission to activate the next bundle | by exec when the new bundle's holder file differs |
| Logic (Bun; a holder child) | `executions.sqlite`, record files, screen, input, stop, rules, resource accounting, `host.sock` and wire to the server; fd and claim copies | on every change of the host bundle or its load entry |
| Server | what to start; bundle preparation; the handover request | — |

- The logic reads and writes all fd through the native library, as PTY does now: then reading stops exactly at a chunk boundary, and there is no Bun stream that read ahead.
- The holder takes the claim; the logic gets its copy at start and takes none of its own (the host itself takes it now, `host.ts:168`), so [[48d023be]] holds in both processes.
- The holder keeps the stdin writing end and the stdout/stderr reading ends too, so a departing logic gives the child neither EOF on input nor SIGPIPE on output. The holder closes the input end copy together with the logic's. The holder closes the PTY slave only after the child got it: closing the last slave earlier resets the window size to 0×0 (holder probe).
- A leader exit is **watched, not removed** by the holder (`waitid` with `WNOWAIT`), and the status and rusage are removed on the logic's command — after the group ended, as with pipes now (`native/PipeChild.ts:220-273`). While the leader is not removed, its pid and group id cannot be taken by another process, so a signal to the leader and group goes before removal and is refused after. The logic signals descendants itself, with birth witnesses ([[b8b6ac56]]).
- The exit status is the holder's fact: the logic records what it answered and does not derive it ([[51c66cb6]]).
- The server raises the holder in its own session (the host now starts without one, `executions/host/boot.ts:208-221`). This also removes one obstacle to launchd supervision from [[2e073431]].
- The generation (incarnation) is the holder's life. Logic that opened the store with a holder already holding generation K continues K; a new holder starts the next one. A holder exec does not change the generation.

### Layers and the platform boundary

The logic declares the holder port in its contract: start an execution (PTY or pipes), answer what is held, run a stop act on the leader or the whole work, close input, remove status, release, report exits, take the handover; the port does not speak POSIX ([[7df613b0]]). The registry works only through this port and the fd it gave; neither logic nor server branches on OS ([[6f758080]]). The POSIX adapter — the holder binary and its client in the logic (fd intake via `recvmsg` of the native library) — is a separate module; the logic's composition connects it.

- **macOS** — now.
- **Linux** — the same POSIX adapter. Linux's own are kernel clocks, process-table reading, and fd-read readiness (instead of kqueue); that work is needed by the current host on Linux even without this spec; the spec promises no deadline for it. The holder's single thread matters here too: the child's `PR_SET_PDEATHSIG` is bound to the thread that started it, and exec leaves only the main one.
- **Windows** — a separate adapter later, and that is a boundary, not a promise. The logic swap carries to Windows whole: HANDLEs copy into the logic process via `DuplicateHandle`. Self-replacement of the holder does not: no exec with the same PID exists there, and ConPTY is not handed to another process. The Windows holder changes itself only without live terminals.

## Swap with the server restart

The successor decides at stage 1 of [[9b246531|handover]]. If the digest of its installation's bundle matches the standing bundle's digest and the load entry (policy, memory share) is the same, the host is not touched. Otherwise the logic changes, and the holder only if its file differs. A matching digest is "the same build": the host wire is assembled into this bundle. Messages between successor and predecessor are part of the [[9b246531]] handover protocol; each talks to the host only in its own build.

1. **Stage 1: the predecessor still answers.** The successor compares the digest before copying and places a changed one atomically (copy into its own catalog, verify, rename): the bundle into `bundle.next`, the load entry beside it. This is a **candidate, not a permission**: until the handover is taken, the holder does not take it. The predecessor asks its host to prepare the swap: the logic checks the bundle (`verifyArtifact`), checks by reading only that the new logic's migration chain continues what is applied in `executions.sqlite`, and takes a screen checkpoint of every terminal where the parser is at rest. If the holder file differs, the holder starts a new holder in check mode on its current table. Any refusal is a typed restart refusal: the predecessor keeps serving, the successor removes `bundle.next`.
2. **Stage 2: handover.** The predecessor's last act over the host is asking the logic to hand over, presenting the quiescence ticket ([[c80af5c5]]). The logic, taking the ticket, **first tells the holder permission to activate `bundle.next`**, then in order:
   1. closes intake and `host.sock` and waits out input acts and starts already inside intake (resize is one ioctl at intake, interrupt a byte in the same queue);
   2. stops output reading at a chunk boundary and finishes everything read into the record and the parser;
   3. drains into the input queue all answers to queries the parser produced, including the one the delivery fiber holds in its hands;
   4. stops the input writer between two records: the write is non-blocking, so the writer either waits for fd readiness or just returned from a write and knows how many bytes of the current act went out;
   5. saves the input remainder — the tail of the current act from the written offset, all queue acts, and the input end if it stood in the queue — together with the parse frontier, plus remembered descendants;
   6. ends taken-but-unstarted commands with "not started", closes the store, and exits.

   The generation stays open in the store: handing over is not shutdown. The handover does not wait for a full input drain: the child may never read stdin.
3. **Holder.** When the logic leaves, the holder with permission swaps the bundles (`bundle` → `bundle.prior`, `bundle.next` → `bundle`). If its own file differs, it execs into the new holder with the table. Then it starts the logic from `bundle`. All of this runs in parallel with the successor opening its stores.
4. **Stage 3.** The new logic opens the store (with migrations), continues the generation, assembles live executions, writes the input remainder first, then starts reading fd and listening on `host.sock`. The successor connects, checks that the host of its bundle answered, and takes custody — this is the "execution host taken" phase of the restart record ([[212d752c]]).

Subscriptions, lanes, and viewer frames do not survive the gap: the server reopens them after connecting, as now. Operation keys and execution records belong to the continued generation, so a lost answer is read back by the server under the same old key ([[72f742cc]]), and record cursors stay valid. A foreign-CLI protocol frame the host took before the swap reaches the child whole and once: taken bytes are either recorded or remainder. A frame the server did not manage to hand to the host whole before the predecessor left stays under the current channel rule ([[6bfa7543]]): that is a server-restart property, and the host swap does not change it.

The gap grows with the number of live executions and the output that arrived after the checkpoint, not with history: retention bounds both. The holder probe gave 68–85 ms from logic exit to the new logic's first read byte with one and with three children; most of it is Bun start, and 1.36 s was met once under machine load (final samples on macOS arm64; not a product measurement). The stand [[212d752c]] measures gap numbers, not the spec.

Logic that fell without preparation goes the same road but without permission: the holder starts the logic from `bundle`, with a pause if falls repeat. The holder takes `bundle.next` without permission only when the logic from `bundle` is not coming up — its start never reaches readiness: then there is nothing to protect, and the next server restart delivers the fix even with no answering logic.

## What the new logic takes and whence

| Fact | Whence |
|---|---|
| What is held: execution id, transport, pid and birth witness, group, fd, observed exit and removed rusage, whether input is closed | holder table |
| Execution, custody, call, revisions, stop intent, keys | `executions.sqlite`, the same generation |
| `call`, `paced` budget | `executions.sqlite`; written at start |
| Call arming instant, program rule deadline | `executions.sqlite`, on kernel clocks; written as they arise |
| Execution pace | `executions.sqlite`; written as it changes |
| Remembered proven-set descendants, input remainder with parse frontier | `executions.sqlite`; written at handover |
| Closed segments with checksums, grid changes | the record journal, finished at segment close and resize; the open segment reread |
| Screen | the last checkpoint and the record bytes after it |
| Rest of the proven set | the kernel process table under the live leader |

- A stop in flight during handover continues on its stop intent from the ladder's first step.
- **A refusal to assemble an execution never permits finishing it.** The holder keeps the fd; the logic takes the execution in the poorest valid form — output record without a screen if the screen does not assemble. If the record does not assemble either, the execution stays unaccepted with the holder: the logic does not read its fd, the host state names it and its cause, and the next logic tries again. Such an execution's child is alive and stands when it fills the output buffer.
- A process binds to an execution only through what the holder gave and the kernel table, never by text ([[62049465]]).
- A revision the old logic gave out (a screen frame, an input profile) does not name the new one's frame or profile: a viewer that named the old base gets a full frame ([[a6da66cc]]).

### Screen

The checkpoint is a sequence of terminal control codes that replays screen, scrollback, and modes on a fresh engine, plus the record byte position up to which it reflects the parse. The terminal language is an external standard, understood by any build's engine, so the screen has no format between builds.

- **What is in it.** Buffers and main modes are written by `@xterm/addon-serialize`: it already stands in the application, with our patch. What it does not write the logic finishes with the same codes, for **both** buffers: stack and flags of each buffer's kitty keyboard (with sequential pushes in it), scroll margins and the saved cursor of the inactive buffer, mouse encoding, cursor style, charsets, tab stops, title, palette and the colors `Appearance` holds. The addon now restores the cursor before writing DECSTBM and DECOM, and those return the cursor home (`apps/tagma/app/node_modules/@xterm/addon-serialize/src/SerializeAddon.ts:533-561` vs `:704-707`): our addon patch puts the cursor last, honoring origin mode.
- **When.** The checkpoint is taken only where the parser is at rest: parser at ground, no unfinished UTF-8 and no open OSC/DCS/APC string; the `@xterm/headless` patch opens reading of rest. Rest is not guaranteed: a program can print an open OSC or one leading UTF-8 byte and wait as long as it likes (`payloadGuard.ts:30-39` counts bytes, not time). So the swap does **not wait** for rest and does not refuse because of the terminal. The checkpoint is taken at the first rest after half-retention of output arrived since the old checkpoint, and at preparation if the parser is at rest; the swap takes the last checkpoint and replays the bytes after it — the new parser arrives at the same state as the old one, including the unfinished sequence.
- **With no valid checkpoint.** A terminal whose last checkpoint retention already evicted, and a terminal with an already unavailable interpretation (`Interpretation.ts:371-375` keeps the refusal forever, `registry/work.ts:54-55` continues the record) carry over with an unavailable interpretation and a continuing record; the process lives.
- **Answers to queries.** The new logic feeds the checkpoint to a fresh engine, then the record bytes from its position. Answers to queries in the bytes up to the saved parse frontier are dropped: the old logic already recorded them or put them in the input remainder (handover step 3). Further answers are live. After a logic fall there is no frontier; then answers to all bytes the old logic managed to finish into the record are not repeated, and an answer it produced but did not record is lost.
- **Acceptance is behavioral**, not a picture comparison: after recovery, output with margins and in origin mode continues into the same cells, and a kitty stack pop and return to normal give the same as on the source engine.

## Clocks and deadlines

- Everything the logic measures on monotonic — the call deadline, the program rule deadline, observation rounds — goes on kernel clocks: shared by all processes since machine boot and not going in sleep (`CLOCK_UPTIME_RAW` on macOS, `CLOCK_MONOTONIC` on Linux). The logic substitutes its runtime `Clock` with a read of these clocks through the native library. `process.hrtime` counts anew in every new process ([[69cf3796|probe]]) and no longer measures deadlines. If the current clocks under `process.hrtime` behave in sleep differently, that behavior change is named by the task; sleep is not covered by the probe.
- The instant on these clocks is saved. There is no need to name the machine boot: executions recover only while the holder lives, so the boot is the same. In the holder probe the new logic executed a deadline set by the old one with no conversion and up to 9.4 ms late.
- The gap counts into the deadline: the command lived all that time. A deadline that expired in the gap executes right after it.
- Wall time stays for display: the wall expiry moment is derived anew from the kernel-clock deadline.
- Load speed (`ProcessUsage`) starts from a new first sample after the swap.
- The holder has no deadlines, so its exec translates none. The holder's event observation after exec is created anew: kqueue on macOS does not survive `execv` even without `FD_CLOEXEC` (holder probe). An exit that happened during exec is not lost: the child stays unremoved, and the new holder at start asks every kept child.

## Failure

| Where | What happens | What with processes |
|---|---|---|
| Stage 1 | typed restart refusal; `bundle.next` removed | all alive; the predecessor answers |
| Logic fell at stage 1, before handover | the holder starts the logic from `bundle`; the candidate untouched | all alive |
| Logic fell handing over, after permission | the holder activates `bundle.next` and starts the new logic, as after a fall; the input remainder and remembered descendants are lost if not yet recorded | all alive |
| Holder exec failed (ENOENT, EACCES) | the holder returns `bundle.prior` and starts the old logic over the untouched store; the successor records the failed host take | all alive; terminals unreachable until the next restart |
| New holder fell after a successful exec, no logic | all fd closed: PTY sessions get SIGHUP, writers at pipes get EPIPE, readers EOF; exit statuses lost | a process that does not die of this lives on without control and without status. **The only uncovered window**; narrowed by a check start passing the successor's whole start path idly, the successor returning to the old holder on start/refusal/panic/fatal signal before logic start, and the holder changing rarely. SIGKILL of the successor, a fall before the return plan is set, and a failed exec back stay open ([[d128a62a]]) |
| New logic does not come up (load error, migration, repeated falls) | the holder holds everything and repeats the start with a pause; it takes a new `bundle.next` once the logic from `bundle` is not coming up. If the activation went without a holder exec, and the old bundle's logic reached ready, by the longest pause with no candidate the holder puts the old bundle back and starts its logic; PREPARE of the bundle it returned from refuses. The logic does not open a store where migrations outside its chain are applied, so after the new logic's migration the return does not raise the old one, and the holder waits for a candidate. The successor records the failed take with its cause ([[6417e7fa]]) | all alive; heavy writers stand on a full buffer |
| Successor died after Yield, cold start at another build's host, or a predecessor handover that never happened | the server places its bundle as a candidate and asks the logic to hand over on the platform signal, naming it by the registry witness; the logic checks the candidate with the same preparation checks. A new-build host with an `executions.sqlite` migration the server does not know is served only by a server of its build: that is a preparation refusal, and the server names its cause in the host state | all alive |
| Logic fell in ordinary work | the holder restarts it; it recovers | all alive; lost are the read-but-unfinished output chunk (13 stdout bytes in the probe), the input remainder, remembered descendants, and a produced-but-unrecorded answer; the screen replays from the last checkpoint |
| Holder fell in ordinary work, logic alive | the logic keeps copies of all fd and the claim; kinship and status removal lost | all alive, see below |

**When the logic sees the holder die** (EOF on the channel to it), it closes and ends nothing. It closes intake of new starts with the typed cause "holder lost" and keeps serving live executions: output, record, screen, input. It sends signals itself and only by birth witnesses — to the leader and proven-set members: the removed leader is now removed by launchd, and its group id may be free. It watches a leader exit by witness and records it as an exit without status or cost — that road already exists (`registry/work.ts:117-127`). The host state names the holder loss. When the last execution ends, the logic exits, and the server raises the holder as on first start. Until then there are no new terminals on this machine; a server restart of another build does not take the host at that time, and executions serve out their time at the orphaned logic. How not to wait for the end of old ones — [[abc8c9fc]].

Not promised: surviving power loss and a new holder fall after exec; unnoticeability for a program measuring output pauses or query answer time; that a program writing a lot will not stall with logic long absent; returning to the old build after an applied migration; output fullness on a logic fall (a read-but-unfinished chunk is lost — the holder probe).

## First enablement

The current host is one Bun process with no holder. It cannot hand fd over and cannot leave without closing it, and taking them without its part is impossible. The predecessor in this update is the operator's build, which knows neither preparation nor handover ([[9b246531]], "different builds"). So in the operator's single update after which this spec stands:

- the successor after stage 3 recognizes a holderless host by its bundle and ends it with that same bundle's recovery program (the `endByRecovery` road already exists). Then it raises the holder from its own bundle and tells the threads about their terminals the same way as on a host replacement now (`tellReplaced`);
- **everything this host holds at that moment breaks once:** every interactive terminal session with all it runs (shell, vim, ssh, REPL); dev servers and other processes started in Tagma terminals; agent background commands; foreign CLI processes (Claude Code, Codex, and others) Tagma holds in PTY or pipes. Descendants from their proven set end with them in a standard host stop; stray orphaned processes stay, as now;
- the output history of these executions stays (records of the old generation read as now), terminal rows with their end cause, and all threads;
- from the next update, executions survive the swap.

The operator needs to do nothing for this, and is asked nothing.

## While the user is alone

- The holderless host is supported exactly once — in the first enablement, and it ends rather than carries over. The first-enablement road is removed as soon as the operator's machine has passed it.
- There is no wire compatibility between builds and never will be: server and host are always one build.
- Kept host data — `executions.sqlite`, records, and the holder table — change the same way as server data in [[5f9b619e|root]]: by a step that once translates the found old form, with reading code knowing only the current one ([[acb620dd]]). The holder table consists of kernel facts alone and changes rarely. The step for it, like migrations, folds once the operator's machine has passed it.

## Delivery order

Main after every landing is a build the operator can update onto from the current host. So the whole host line is built in its own worktree and lands in main in one merge that already includes first enablement; intermediate line states — a holder without recovery, removed roads without first enablement — live only in the worktree, and two host forms never sit beside each other in main. The server part starts once [[9ae1db7b]] is already in main: the worktree first updates from main. Before the merge the worktree updates from main again, and the line checks pass on the final tree. Removing the first-enablement road is a separate landing, after the operator updates.

## What [[9b246531]] replaces and what leaves

[[9b246531]] recorded: "The successor takes a compatible live host; a staying-idle host replacement goes after stage 3. An incompatible wire stays a refusal named at stage 1". Now a host with a different digest changes in the gap between doors without ending executions; there is no more "compatible", "idling", or wire refusal. Comparing the digest before copying stays there.

Leaving: wire compatibility checks (`spokenWire`, `compatibility`, `executions/host/preflight.ts`, `preflightCutover`); replacement modes `when-idle` and `force` and deferred-replacement repeats (`executions/host/replacement.ts`, `watchReplacement`, `HOST_REPLACE_ONCE`); the `replace_host` operation and `tagma terminal replace-host`; the road of a host the server cannot talk to — except first enablement while it is not passed. With them [[072fb619]] loses its subject: the code it fixes is removed.

## What shows it works

**The implementer proves** — a system test on one's own host in one's own state catalog (`*.stest.ts`, within 60 s per file):

- The holder is raised from bundle A. Live: an interactive PTY shell (`bash --noprofile --norc -i` with a trap on SIGHUP); a dev server on pipes with a TCP port and a counter; a command on pipes with a counter in stdout and stderr reading stdin; a held process in a PTY in alternate screen with scroll margins, origin mode, bracketed paste, and a kitty keyboard stack; a background command with a lifetime.
- A swap to B with different logic, then to C with a different holder. Checked: the holder pid and all children pids unchanged; every counter sequence in the record full and without repeats; input cut by the writer boundary (an act larger than one write into a child reading slowly) arrives whole and once; a command typed into the shell after the swap answers from the same pid; resize after the swap arrives; the dev server answers with the same pid; the held process after the swap keeps printing into the same cells, and its kitty stack pop and return to normal give the same as without a swap; a DSR asked before handover gets exactly one answer; a child that exited after the swap returns its code; the background command's deadline fires at the same moment; execution refs are of the same generation; no SIGHUP arrived.
- A terminal with an open OSC without a terminator and a terminal with an unavailable interpretation: the swap passes, both processes alive, the record continues.
- Logic B exits at load: children alive with the same pids; after a working logic is offered, everything continues without loss. Logic A killed at stage 1 before handover rises again from A, and candidate B is not activated.
- `kill -9` of the logic in work: the holder raises it, children alive, the screen recovered.
- A new holder refused in check mode: the host stays the old one and answers.

Separate owner checks: the screen checkpoint forth and back with the behavioral acceptance above; generation and record continuation in another process; the holder protocol with a real binary, including exit observation without removal and a group signal after the leader exit; logic that lost its holder continues executions and closes only new starts.

**Through the server** — the restart stand [[212d752c]] on one's own instance: a restart with a changed host bundle on a live held process speaking ndjson over a real link (`external-harnesses/protocol/link.ts`). A frame larger than one chunk, taken by the host before the restart, reaches the child whole and once; after the restart the server consumer reads output on from the old record cursor with no gap and no lost bytes.

**Checked by the operator** (not a task completion condition):

- First update: the old executions ended exactly once, asked nothing.
- The next update where the host changed, with vim open in a terminal, a working dev server, and a running Claude Code thread: after the window everything is in place and continues; `tagma status` shows the host of the same build as the server.

## Out of scope

- Linux and Windows adapters, a non-POSIX port, and terminal parity with the old host — [[7df613b0]]; its steps 1–3 stand in this line before the host handover and recovery step.
- launchd supervision — [[2e073431]].

## Build order

In the line worktree: [[e946bdd8]] → [[0308b97d]]; in parallel [[c35942b0]], [[854c7e1f]], [[5084ccfe]]; all of them → host handover and recovery → [[9d2e407b]] → [[2e350fc3]] (after [[9ae1db7b]] in main) → [[a06a1a9e]] → [[7c1b6811]] in main → after the operator updates [[93ba9131]].
