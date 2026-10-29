---
id: 01a16195-9d3d-7c4c-959f-992dafeadae2
title: "TypeScript adapter measurements on runlith: benchmark, latency by engine state, memory"
ord: 1
---
One sample: macOS arm64, 12 cores / 32 GB, TypeScript 7.1.0-beta, working runlith checkout (92 tsconfigs) under unrelated load — machine load average 6–28 during the runs, so cold numbers spread by multiples. The script is `bench.ts` in the scratch of thread 01a16167-afd2-77b1-bc67-9aa426ed792e: engine inside the script process, candidates via ripgrep by name over the whole checkout, alias passes up to two hops as in the kit; seven benchmark symbols in a round. Seven runs were done; ranges below.

**Surface: API.** Verdicts come from the standing API checker in per-file batches. No LSP variant was prototyped or measured; the argument for the API is the measurement below (a quiet checkout does not cool down) and the spec's rules on alias and projection, which reference search does not know.

**Benchmark:** 74 of 74 in all states, including three `rowsOver` calls through fixture destructuring (alias through a returned-literal shorthand property). "Unverified" is 0 to 2.6% of a symbol's candidates (most for `release`: 84 of 3288, 35 of them files outside programs), below the gate's 6.05% ceiling.

**Answer latency** (whole question: locate, judge, alias passes, no ripgrep; 12–8060 candidates per symbol):
- first semantic question of a fresh engine: 8–45 s (`stop`, 3803 candidates); next new names 0.2–8 s;
- warm: p50 157–260 ms, p90 204–650 ms; widest (`standing`, 8060 candidates) 200–420 ms;
- after 35 s idle: p50 170–211 ms, p90 379–727 ms — idle does not cool down;
- while warming a new snapshot (repeating the last questions at 8 files per request): p50 235 ms, p90 564 ms; without that slicing, warmup held the question up to 5.5 s;
- after an edit (new file in the server program): the new snapshot becomes serving after 7.4–8.2 s of warmup; then p50 175 ms, p90 607–707 ms.

Runs before the `ensurePrograms` fix (the post-edit snapshot did not rebuild programs) gave 2–3 s of warmup after an edit and p90 214–326 ms — that is not a new-program measurement; the numbers above replace them.

**Memory** (RSS): `tsc --api` 2.4–2.6 GB after load; 4.0–5.7 GB during question series; 0.7–2.5 GB after idle. Bun client 0.5–1.1 GB. `GOMEMLIMIT` 2–2.5 GiB is below working volume: GC thrashes, first question 42–96 s; 4 GiB peaks at 4.6 GB with no slowdown; `GOGC=25` lowers post-idle RSS to 0.7 GB, leaving the peak unchanged. The settled state is markedly below the previous 3.2–4.5 GB; the peak during series is not.
