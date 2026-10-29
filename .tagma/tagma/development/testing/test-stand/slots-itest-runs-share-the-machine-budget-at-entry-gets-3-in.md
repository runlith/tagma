---
id: 01a17c03-5070-7fca-87bc-ba30496d08da
title: "`slots.itest` › “runs share the machine budget at entry…” gets 3 instead of 4 when the killed CLI already birthed the runner"
ord: 19
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17bce-4cee-7d48-b88e-bdd094317a80",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a17bc1-a01d-7b75-a899-a9fc054f5a04
sources:
  - kind: file
    ref: packages/testbed/src/slots.itest.ts
---
A mixed unit+itest testbed run on `--randomize --seed=2` failed twice in a row on 2026-10-27: `expect(await held(next)).toBe(budget - shares[1])`, expected 4, received 3. The test and the itest run each passed alone.

Root: the CLI prints `testbed: N of …` before starting the runner, and passes the queue entry (`units.entry`) to the runner as fd 3. The test killed only the CLI right after this line. When the runner was already born by then, it survives the CLI (`ppid 1`, its files held until the test's release) and holds the entry's flock. Then `next` counts it as a neighbour and asks `ceil(8/3) = 3`; when the CLI died before the runner started, it came out 4. This is a probe, not a guess: a CLI killed after the runner's birth left the runner alive for the whole watch. The budget counts a runner surviving a killed testbed as a neighbour on purpose (f7db8209), so the defect is in the test: the "processes of a killed run return" contract needs the whole killed run.

Fix: holding files leave a marker, the test waits for it through `fs.watch` (workers output under `--parallel` reaches the coordinator only at the file's end), the run starts in its own process group, the whole group is killed, and the test waits for the EOF of its stderr — the kernel closes fds in decreasing order, so the queue entry's fd 3 closes before fd 2. Waiting for the marker with the old kill of one CLI the test is deterministically red (4 vs 3), with killing the group green.
