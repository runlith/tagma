---
id: 01a16421-f7f2-732a-be55-63478689cf64
title: "Navigation engine idle on runlith: post-idle question cost per layout, idle memory and a small memory limit"
ord: 5
edges:
  - kind: discovered-from
    to: 01a16403-be0b-7926-b159-d9b22eb85f6b
---
One sample: macOS arm64, 12 cores / 32 GB, TypeScript 7.1.0-beta (tsgo), main runlith checkout (HEAD fedc5a765a…d2d641a33, 111 tsconfigs) under unrelated load — load average 5–18. While the measurements ran, neighbors edited the checkout, and the stand snapshot did not track them: benchmark completeness is not verified here. Memory is the sum of `phys_footprint` of the process tree (Bun client and `tsc --api`, with `tsc` alone in parentheses). Unless stated otherwise, the engine runs with `GOMEMLIMIT` 9 GiB, `GOMAXPROCS` 4, `GOGC` 50 — as from the holder on this machine. Scripts in the scratch of thread 01a16404-90d6-734e-9f24-aaa962b09c4a: `idle.ts` — adapter directly over the API, as `direct.ts` from [[0c5ff859]], no ripgrep and no kit; `e2e.ts` — built launcher, engine process and kit with ripgrep; raw events in `idle-*.json` and `e2e-*.json` there. Time is seven benchmark symbols in a round; "first question" is `stop`, the heaviest.

**What an idle question costs under each layout** (`idle.ts`, after a cold round and two warm ones):

| Idle layout | Idle memory, GiB | First question after idle |
|---|---:|---:|
| Stop the process (previous 15 min term) | 0 | 16.1–16.3 s from start to answer (`e2e.ts`, load 4.1–4.2 s + question 11.9–12.0 s) |
| Drop checkers, keep parsed files (new snapshot of the same programs) | 3.06 (2.97) | 9.0 s; `standing` 1.45 s |
| Close all programs | did not fall for 45 s: 5.07 (4.99) | 31.1 s |
| Keep warm, do nothing | 5.84–5.91 (5.47) — unchanged for 45–150 s | 0.09–0.11 s of adapter |
| Keep warm and collect TS garbage (`saveHeapProfile` → `runtime.GC()`) | 4.11–4.12 (3.73) after 30–60 s | 0.09–0.17 s of adapter |
| Same plus drop the client source cache + `Bun.gc` | 3.82 (3.73; client 0.38 → 0.09) | 0.65–0.68 s — rejected |

The last option without the client cache drop was chosen: the engine does not stop, but after 30 s of silence it collects TS and client garbage. Go itself did not return garbage to the system while idle: `phys_footprint` stayed flat for 2.5 min after a series of questions.

**Built engine** (`e2e.ts`, two runs; whole kit question with ripgrep, adapter time separately):
- from process start to first answer 16.1 / 16.3 s — the price a question used to pay after 15 minutes idle;
- in work after a series of questions 4.84 / 4.76 GiB; after 30–40 s of silence the engine collected garbage itself — 3.91 / 3.81 GiB, then flat;
- first question after 60–90 s idle: `stop` 684 / 574 ms (adapter 79 / 72 ms), `standing` 280 / 285 ms; post-idle round p50 244 / 192 ms, p90 304 / 256 ms — like warm rounds before idle (p50 360–514 ms, p90 473–624 ms).

**Small machine** (`idle.ts`; limit and cores set via environment variables, physical machine memory not reduced, so compression and page eviction of a truly small machine are not reproduced):
- `GOMEMLIMIT` 2 GiB, 3 cores: load 6.1 s, first round up to 31 s, warm p50 91–94 / p90 508–524 ms; `tsc` memory 3.4–4.1 GiB;
- `GOMEMLIMIT` 1 GiB, 2 cores: load 26 s, first round up to 58 s, warm p50 161–203 / p90 552–774 ms, idle garbage collection 13.8 s; `tsc` memory 3.4–4.3 GiB.

A limit below the live heap does not lower process memory — `tsc` holds 3.4–4 GiB under any of the three limits — it only multiplies load and cold-question time. So the smallest engine limit is 2 GiB: a smaller machine gains nothing below it.

Not measured: other machines and repositories, a real 8 GB RAM machine, idle beyond 2.5 min, idle worktree on the built engine (worktree rest verified only by an integration test), tsc-rs.
