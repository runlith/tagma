---
id: 01a161e6-2956-7db8-9e3c-3e4573644789
title: TypeScript engine memory on runlith before and after lazy programs and `GOGC=50`
ord: 1
---
One sample: macOS arm64, 12 cores / 32 GB, TypeScript 7.1.0-beta, working runlith checkout (112 tsconfigs, 15,215 distinct files), load average 3–8. Scripts in the scratch of thread 01a16167-afd2-77b1-bc67-9aa426ed792e: `bench.ts` — the same run as in the [[afeadae2|previous measurements]] (seven benchmark symbols in a round, 35 s idle, an edit and deletion of a file in the server program), now sampling RSS every 100 ms and with `GODEBUG=gctrace=1`; `probe.ts`, `parts.ts`, `lazy.ts`, `swap.ts` — heap analysis via `api.debug.saveHeapProfile` (it calls `runtime.GC()` itself, so the number is the live heap).

**Where the peak went** (before the fix, no limit, `GOGC=100`):
- live heap after load 2.04 GB — parsing and binding 15k files (~0.13 MB per file, a shared file parsed once); the series touches 4 of 112 programs, their files are 1.25 GB, the remaining 0.8 GB is unneeded;
- checkers: one standing API checker per touched program, the language service not involved, batched requests create no new checkers (the TS 7 pool gives the API one slot per program). `getSymbolAtLocation` over one series' candidates adds 1.33 GB, the rest of the verdict calls 0.09 GB — almost all is the server program's checker;
- after the series the live heap is 3.44 GB, but RSS is 5.4–5.8 GB — the difference is garbage between collections at `GOGC=100`;
- after an edit, both server programs with their checkers live while the new snapshot warms up: live heap up to 5.2 GB, RSS 6.3 GB;
- with the holder-issued 4 GiB limit, the previous code went into a from-scratch snapshot replacement on every edit (process tree ×2 over the limit), and with a limit close to the live heap, collections ran back to back.

**After the fix** (lazy programs, `GOGC=50`, `GOMEMLIMIT` 4 GiB, `GOMAXPROCS` 4):
- live heap: 1.39 GB after load and closing unneeded programs; 2.6–3.6 GB in a series; 2.65 GB after snapshot replacement; up to 3.6 GB while the new snapshot warms up;
- `tsc --api` RSS: 2.6 GB after load (all programs open before the first question); 3.5–4.0 GB in a series, peak 4.06–4.09 GB — RSS is pressed against the limit because Go returns freed memory to the system lazily, and the limit forces it; 3.3–3.9 GB after 35 s idle;
- Bun client 0.5–0.97 GB (unchanged);
- benchmark 74 of 74 in all states.

**Latency** (p50 / p90; previous numbers from [[afeadae2]], taken with no memory limit):
- first question of a fresh engine: up to 8.7 s (was 7–45 s); new names 126–758 ms (was 0.2–1.6 s);
- warm: 158–182 / 209–291 ms (was 152–260 / 205–650);
- after 35 s idle: 167–179 / 225–315 ms (was 158–211 / 285–727);
- while warming up: 169–188 / 805–1034 ms (was 235 / 564);
- snapshot replacement after an edit 9.6–12.4 s (was 7.4–8.2 s);
- after an edit: 168–180 / 935–1121 ms (was 175 / 607–707).

Warmup and post-edit answers are slower than before because the previous measurements ran with no limit: while two server checkers are alive, the live heap approaches 4 GiB and collections become frequent. The same runs with lazy programs and no limit give p90 783–843 ms during warmup and 592–627 ms after an edit.

**`GOGC`** at a 4 GiB limit on 4 cores: 25, 50 and 100 give the same latency and a 4.0–4.3 GB peak — the limit dominates; with no limit, 50 holds RSS around 1.5× the live heap. On one core, 25 lengthens the cold question (p90 17.6 s versus 13.9 s at 50).

**One core.** The holder on this machine then gave the engine `GOMAXPROCS=1` (two engines per quarter of 12 cores); since commit 2bc46fffae each engine gets 3 to 4 cores ([[2f766065]]). Then, at any `GOGC`, one collector pass over a 3–4 GB heap takes up to 7–9 s: cold p90 13.9–17.6 s, during warmup p90 1.6–3.9 s, after an edit p90 1.4–2.2 s. Those are multi-second pauses, and the holder's core share in the budget removes them, not the adapter.
