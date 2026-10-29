---
id: 01a17b1b-8016-7f44-ab6d-f7b000f3fe53
title: Pty bytes and terminal input are held by a dedicated logic thread with the OS interactive class, while the main loop receives output as a copy
ord: 7
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a17aff-0013-783e-93b0-8215dc3c916a
sources:
  - kind: file
    ref: packages/execution-host/src/posix/Descriptor.ts
  - kind: file
    ref: packages/execution-host/src/posix/terminals.worker.ts
  - kind: file
    ref: packages/execution-host/src/posix/TerminalThread.ts
  - kind: file
    ref: packages/execution-host/src/TerminalInputs.ts
---
The logic main loop serves all executions at once — process traversal, writes, the screen mirror — and on a saturated machine gets no CPU for seconds; a press waited on its queue ([[dc3c916a]]). The terminals thread only moves pty bytes, admits input, and serves the endpoint through which the window prints and reads live output past the main loops ([[19621016]]). It raises its QoS class before opening its reactor: a kqueue thread inherits its creator thread's class.

- **Reading ahead.** The thread reads pty without waiting on the main loop, into a buffer up to `READ_AHEAD_BYTES` per terminal; a full buffer stops reading, and the child blocks as on a slow write medium — the write loses not a byte.
- **Logic change.** `stopReading` answers when reading has stalled. The buffer the main loop never read goes to the successor as the first `pendingEchoes` element with `after` 0, ahead of the synthetic echo; so `Owe` is accepted only before the first read. That element is marked as output (`output`): an interrupt without NOFLSH resets only the synthetic echo at the successor. Bytes pty already gave away, the kernel does not take back with its flush, and the host loses none either.
- **Input outlives the fd.** The input queue lives in the thread until the owner scope on the main loop releases it: after the terminal's end, frontier, finish, and fence answer as before.
- **Closing the thread.** The scope waits for confirmation that the thread closed its PTYs before completing the Worker: the fd table is shared with the logic, and forcing the thread to finish does not free them by itself.
- **The main loop's work stays its own.** The thread asks the main loop about input end (closing at the holder) and resize consequences — the write grid, the interpreter — and waits for the answer. Presses don't travel that path: a resize awaiting an answer holds only its own lane and other resizes ([[447ddfbb]]).
- `TerminalInputs` holds input on the main loop by default — that is how holders without a thread work; the POSIX holder installs its own thread. A lost thread is a defect: terminal reads and writes answer with refusal, input questions die.
