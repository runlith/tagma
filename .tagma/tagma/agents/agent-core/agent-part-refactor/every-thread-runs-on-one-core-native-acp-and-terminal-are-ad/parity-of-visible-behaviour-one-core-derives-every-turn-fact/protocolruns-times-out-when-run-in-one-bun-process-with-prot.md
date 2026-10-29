---
id: 01a14e53-6096-7c4a-a466-3bfa8ffdfd41
title: protocolRuns times out when run in one bun process with protocolStops and protocolHandover
ord: 17
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14cfa-01f6-7d00-af4d-7f2b2b1aecb7",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14e43-2bcd-7818-8b69-eeb01f3cc08a
---
`protocolRuns` times out when run in one bun process together with `protocolStops` and `protocolHandover`.

parity-end saw it twice, before and after 1f3cc08a: `protocolRuns` alone 7/7, but in one `bun test` with `protocolStops` and `protocolHandover` — 5 timeouts. A similar picture on parity-launch: `protocolMethods` in a shared run cascades with "the sqlite connection closed", alone 19/19. So the suites share process state (a global store, clocks, an unclosed scope) — a stand or product defect, not yet known.

Find the shared state and remove it at its owner's stand or product; proof — all protocol*.stest green in one process. In passing — the test for the case 1f3cc08a proved only by reading: the session lease is still fresh when the reaper has already ended the run (after a crash), and the cancel still reaches the vendor.

## Outcome (697ae423b5, 0fb0a65625, 029c1da69d)

The shared process state is not the stand or the product, but `bun test` itself: when a test file overruns its time, bun kills every child process the file started ("killed N dangling processes"), including the world's host and agents shared by all tests in the file. So one timeout toppled every later `protocolRuns` test (and likewise `protocolMethods` with "the sqlite connection closed"). The first timeout was the test "one ACP turn is one run activity…": it stopped the turn without waiting for `session/prompt` at the agent. After the heavy live `protocolFork` test, session opening ran slower, the stop arrived before the prompt, the `run` activity never opened, and the test waited 20 s for its close. Now the test waits for the prompt (via the stand's `heard`). The reader-stop test in `protocolActs` waits for the run end instead of checking it right after `session/cancel`: an adapter run is ended by its own `ended`. Live Claude tests (`protocolClaude`, `protocolFork`) get a 90 s budget instead of 45: a slow answer from the real model was a timeout that killed child processes.

The fresh-lease test went into `protocolStops`: red with a one-shot `attendance.ensure` (the stop fell `session-owned`), green with `recall` (~16 s — the takeover-tick wait).

Measured: all 19 protocol*.stest files in one process — 114/114 once; in the next three runs one or two tests failed (the fixed protocolActs test, and separately the live Claude test with a real 17 s model — by the model's answer, passes alone). Not proven: the live Claude test is stable — it depends on the real model and the network. A review finding — a run stopped before the prompt ends with no `run` activity: [[e92b448b]].
