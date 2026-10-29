---
id: 01a17aff-0013-783e-93b0-8215dc3c916a
title: "Terminal keypress and echo wait for neither the server nor the host logic: pty bytes travel on a separate execution stream with a direct window connection"
ord: 42
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a0fd8b-bf17-7729-bc6f-2284f37a2606
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47c97b9b56cc
---
**Why.** Under a fully loaded machine — agents running tests, builds and typecheck on every core — input in the Tagma terminal lags by seconds, while the composer and the t3code terminal don't lag at the same moment. Measurement of 2026-10-27 on 12 cores at load 51: one `terminal.input.write` keypress took 29 s — 20 s waiting for previous keypresses of the same terminal (the server lets them through strictly one at a time, `executions/terminal-input-turn`), 8.3 s waiting for one of the 2 server → host control-channel slots shared with agent commands' Start, Stop and Pace, 0.7 s answered by the host itself. In this window the host logic loop made 9 turns in 5 s instead of ~470; over a 505 ms stall its thread got 45 ms of CPU.

The root: terminal bytes have no path of their own. Keypress and echo pass through the server's main loop and the host logic's main loop, where all background work runs — native agents, the graph, change accounting, process walks for pace and load, the record and the screen mirror — and stand in their queues. When the machine is saturated, these loops get less CPU than their background work demands, and the keypress waits at the queue's tail. In t3code a keypress is a pty write in a process with nothing else to do. This touches every user whose agents load the whole machine, on any core count, and agents' input into their TUIs in Tagma terminals.

**What will be.** Keypress-to-echo latency in the Tagma terminal doesn't depend on what keeps the server and the host logic busy: neither their load, nor a synchronous stall of their main loops, nor another-request queue to the host delays keypress or output. The user configures nothing.

**How.**

1. *The host terminal stream* — the new owner of byte carry for every pty-transport execution. It is a separate execution stream (a Bun Worker) in the host logic process with the OS interactive scheduling class: `QOS_CLASS_USER_INTERACTIVE` on macOS, the class for work a human waits on elsewhere. The stream reads the pty master, writes to it, does interrupt and its synthetic echo (`Descriptor`) and admits input (`ExecutionInput`: lanes, receipts, backpressure, reset on interrupt, carry-over on logic change) — with the same code moved into the stream. Pipes executions — the bulky command output — stay on the main loop: the interactive stream shares no time with them. The stream is one for all terminals and serves them in readiness order, so one terminal's output stream never holds another's input.
2. *The logic main loop* stays the owner of the execution lifecycle, custody, the record and the screen mirror. It receives pty-read bytes as a copy through the stream's bounded buffer; when the buffer is full, the stream stops reading pty: the record loses no byte, and the child blocks as it does now on a slow carrier. Input from the control plane — agents in their TUIs, the grid, resize, the server — goes to the same `ExecutionInput` as a message to the stream.
3. *The terminal endpoint.* The stream listens on its own WebSocket port on loopback. A lane the server opened after its own permission check, as now, the host registers in the stream with a one-time secret; the lane-open answer carries the endpoint address and the secret. One connection carries the lane's input acts (bytes, interrupt, resize) with their sequence, receipts in answer, and live pty output from the requested offset. An execution owner change (rule 39f511b4), permission revoke and execution end close the connection. Secret admission is one check at connect, not per keypress: permission is settled at lane open.
4. *The server is control plane only.* It opens and closes lanes, serves record history and the grid. Who typed (`TerminalWriters`) and whose view settles the grid (`InputWitness`) it learns from the host's admitted-input reports, which arrive asynchronously by subscription, not from an answer to each keypress. Window writes through `terminal.input.write` and the sequential lane queue on the server go away.
5. *The window.* `Input` sends acts into the lane connection, `RecordStream` reads record history as now up to the seam and then takes live output from the same connection; a broken connection reopens the lane and resumes from the cursor and unacked sequences, as now after reconnect.
6. *Remote access.* The endpoint is exposed in Tailscale Serve as a separate site on its own HTTPS port, like plugin sites; the server names the address to the window by the path the window reached it through.

**Why this way.**
- The whole server's or the host logic's priority can't be raised: Tagma's background work would stand ahead of the user's programs, and the keypress would still wait its turn in the shared loop.
- A separate slot for Input and a pipeline instead of the lane queue remove amplifiers, but not the main loop, which stands for seconds under load.
- A Rust stream in the native library would need `ExecutionInput` and `Descriptor` rewritten; a Worker takes them as they are. A 2026-10-27 trial on the host build: the library's native reactor with a threadsafe callback and `Bun.serve` work in the Worker, `pthread_set_qos_class_self_np` moves the stream from 21 to 33 (user-interactive), and while the main thread was busy for 1.5 s, the stream's WebSocket answered in 0.2–6 ms.

**Acceptance.**
- itest: while the host logic main loop is synchronously busy for 2 s, a keypress's echo through the terminal endpoint arrives within 100 ms; the same with the server main loop busy for 2 s.
- itest: the twentieth queued keypress arrives with the same latency as the first: keypresses don't wait for each other.
- A saturation measurement: every core busy with same-priority processes, several other terminals printing non-stop; p50 and p99 from keypress to echo recorded as one sample with machine and load next to the same numbers for direct pty writes from an idle process.
- Input and record contracts hold: the `ExecutionInput`, interrupt-reset and synthetic-echo, receipt, logic-change carry-over and rule 39f511b4 tests pass with input in the stream; the terminal record matches byte-for-byte what the window received live.
- Agents type into their TUIs through the control plane, as now.

**Saturation measurement — one sample, 2026-10-27, bench 14891c58a7.** Machine — Mac14,6, Apple M2 Max, 12 cores (8 performance and 4 efficiency), shared: others' tests ran on it. One-minute load: 4.1 before the run, 14.2 at the end of the load. The minute average lags, so during the load the true load is higher.

The load held about 20 s of the 37 s run; this is estimated from phase durations, not measured separately. It consisted of:
- 12 `perl` loops at normal priority, one per core;
- 4 other terminals of the same host, each printing about 800 KB/s (100 lines of 80 bytes every 10 ms). Their output over their lanes is read by a separate Bun process, and over the run it never fell behind or lost a lane.

How it was measured:
- Host — a real holder with `src/main.ts` logic.
- After a 3 s warm-up come 400 keypresses through the endpoint, then 400 by direct pty writes. Each keypress waits for its echo, the next goes 15 ms later.
- The shell in both paths is `/bin/sh` (bash 3.2). Its readline prints the echo, so every latency includes waking the shell.
- The lane client is a separate Bun process at normal priority. Direct writes are made by an idle Bun process through `Bun.Terminal`.
- The window browser and the server aren't part of the measurement.
- "Idle" is the same shared machine without the bench load.

| path | idle, p50 / p99 / max | saturated, p50 / p99 / max |
|---|---|---|
| terminal endpoint | 0.73 / 3.39 / 9.37 ms | 0.47 / 25.5 / 50.1 ms |
| direct pty write | 0.03 / 1.44 / 3.72 ms | 0.06 / 12.2 / 13.9 ms |

Saturated p99 through the endpoint is 13 ms above direct writes; where that difference comes from wasn't investigated. Repeat the measurement: `bun src/terminalEcho.bench.ts` in `packages/execution-host`, flags `--keys`, `--burners`, `--printers`.
