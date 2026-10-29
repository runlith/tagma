---
id: 01a16fbd-b4fa-7f3d-8686-f6122255f40d
title: "Where runlith tests lose time and CPU: verified hypotheses and levers, 2026-10-24"
ord: 39
---
Measurements 2026-10-24, 22:40–23:00, Apple M2 Max, 12 cores, 32 GB, Bun 1.4.3; each a single sample. Subject — the heaviest slice of the server integration: 126 files, 608 tests, detached worktree at 4215a3557a4. Probe switches (`PROBE_NO_FULLFSYNC`, `PROBE_BASE`) stood only in that worktree, never committed; raw data — the orchestrator's `x10/probe/` scratch.

**Refuted.**
- `F_FULLFSYNC` in durable SQLite: 44 and 49 s with it, 49 s without, CPU identical. The call itself costs 4.5 ms, 24 ms at 10 parallel — but the slice never waits on it.
- Disk: test homes on a RAM disk vs SSD — 87.5 and 89.5 s vs 90.5 s, runs interleaved. Disk under the slice — 4400 ops/s, 63 MB/s.
- Fake git as the top lever: git — 5018 starts, 39 s, 16% of the slice's CPU (20% of the whole server-integration A run); `git rev-parse` costs 4.1 ms wall and 3.4 ms CPU, 5.7 ms at 10 parallel threads.

**Confirmed.**
- Bun processes that raise tests (servers, hosts, SQLite children): 362 starts, 87–258 ms CPU each, 70 s — 28% of the slice's CPU.
- Parallelism duplicates work: the same slice in one process — 140 s CPU and 118–134 s wall, on 10 workers — 248 s CPU and 44–49 s wall. Every worker rebuilds its worlds and reloads modules.
- A worker is on CPU about 55% of its time. Under other agents' load the same slice ran 87–90 s instead of 44–49 at the same CPU, and 5–10 tests failed on timeouts: tests wait on worlds, restarts, and polls. The slice's wall floor is set by three 30–34 s files.
- Affected-test selection: `check:change --plan` over the last 20 HEAD commits selects 66% of all tests' CPU on average (0.1% to 99%). Server tests raise the whole composition, and nearly any server change touches nearly all of it.
- Inside a test process: the Effect runtime — 34% of own time, SQLite paths — 36% inclusive, process starts — 12%, product telemetry (`packages/performance`, `cpuUsage`) — about 6%.
