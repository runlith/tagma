---
id: 01a17013-3f6a-7d64-8f31-d9c350db5e4a
title: power.agentWork = low gives agent commands about 3 cores out of 12 while a third of the machine idles — not "every core when nothing else wants it"
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "Total work falls as N grows: 1 process — 7.8 s CPU over 8 s; 4 — 23.4 core-s (2.9 cores); 8 — 22.1 (2.8 cores); 12 — 20.5 (2.6 cores); top meanwhile shows 35–45% machine idle. Under taskpolicy -b — 0.95 cores.",
    "command": "Agent bash at power.agentWork=low: N parallel `bun spin.ts 8000` processes (pure compute, no I/O), N = 1, 4, 8, 12; then 12 under `taskpolicy -b`",
    "expected": "Per the Low description (“yield to your programs and use every core when nothing else wants it”) 12 compute processes take the free cores — on a machine with ~35% idle that is about 8 cores."
  }
---
Filed from project `runlith`.

Machine: Apple M2 Max, 8 P-cores and 4 E-cores, macOS 26.0.1; 2026-10-25 around 00:40 local time. Agent commands run at ps pri 20, i.e. QoS utility, which Pacing sets for low (packages/execution-host/src/Pacing.ts, note 8b2e7319). The machine was not quiet during the measurement: other threads were working, load average 18–20; so the absolute numbers are one sample under load, but the falling total work with growing N and the ~35% idle were observed in the same window.

Impact on agent work: a full test:all with 10 workers (the testbed budget) ran all evening at load 20–47 with 35–55% CPU idle, files took twice as long as one by one, and 10–22 tests failed on deadlines though passing alone. The cause conclusion is a hypothesis matching the measurement: work on QoS utility under contention gets roughly the E-cores, while the P-cores stay free. The check is the same measurement at power.agentWork=full (an operator-only setting). If confirmed, the Low description does not match the behavior, and agent work needs a way to yield to the human without barring the P-cores (e.g. nice with no QoS clamp) — that is a product decision.
