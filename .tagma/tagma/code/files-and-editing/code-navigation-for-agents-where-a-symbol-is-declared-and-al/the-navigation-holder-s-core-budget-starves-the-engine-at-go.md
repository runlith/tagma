---
id: 01a161e6-c102-7926-a751-d0793a2938f1
title: "The navigation holder's core budget starves the engine: at GOMAXPROCS=1 a collector pass over a 3–4 GB live heap takes 7–9 s"
ord: 26
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16167-af2e-7642-afb4-68ae2d214648",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a161b5-a49c-7507-9b1e-b23c1588ddf7
  - kind: implements
    to: 01a1612d-2135-7f12-8deb-91b934378e8f
---
The navigation holder's core budget starves the engine: at GOMAXPROCS=1 a collector pass over a 3–4 GB live heap takes 7–9 s. The holder shares a quarter of the machine's cores among all engines (`apps/tagma/server/src/navigation/budget.ts`), so on a 12-core machine with two engines each gets `GOMAXPROCS=1`. Measured at the adapter after the memory reduction ([[73644789]]): with one core a pass over a 3–4 GB live heap takes 7–9 s — cold p90 13.9–17.6 s, during warm-up p90 up to 3.9 s, after an edit 1.4–2.2 s; with four cores it is 0.8–1.1 s and below. The core budget must cap machine load, not turn it into multi-second stalls: e.g. cap the engine at a share of cores instead of splitting it among idle engines — the budget owner decides by measurement. Verify on the adapter's same question series.

**Budget-owner measurement** (one sample: same 12-core / 32 GB machine, load average 6–11, `bench.ts` from [[73644789]], `GOGC=50`; p90 in ms, reference 74/74 in all runs):

| cores / limit | during warm-up | after edit | after removal | snapshot replace |
|---|---|---|---|---|
| 1 / 4 GiB (at the adapter) | 1600–3900 | 1400–2200 | — | — |
| 2 / 4 GiB | 2052 | 1429 | 1601 | 12.8 s |
| 3 / 4 GiB | 1327 | 1161 | 1099 | 12.7 s |
| 4 / 4 GiB | 744 | 875 | 814 | 11.3 s |
| 2 / 6 GiB | 1500 | 1145 | 566 | 9.2 s |
| 3 / 6 GiB | 1015 | 649 | 589 | 8.5 s |
| 4 / 6 GiB | 1055 | 590 | 586 | 7.3 s |
| 3 / 2 GiB | 1268 | 1581 (p50 964) | 1367 | 17.4 s |
| 3 / 3 GiB | 1653 | 1184 (p50 832) | 1283 | 17.3 s |

Warm p90 in all runs with a limit ≥ 4 GiB is 214–371 ms; the cold first round is 8.7–10.5 s (19.3 s with a 2 GiB limit). At a 4 GiB limit RSS holds at 4.0–4.2 GB, at 6 GiB the peak is 4.3–5.2 GB, and after idle the process returns memory down to 0.8–2.8 GB. Below a live heap (2–3 GiB) RSS is still 3.9 GB while p50 grows to 0.5–1 s: such a memory limit saves nothing.

Decision: each engine gets its own core share (a third of the machine, 3–4, no more than half); the engine count is capped by memory (5/16 of the machine; each engine with a 1 GiB client margin counted by the driver too) and by cores (all engines together take no more than two thirds of the machine); an engine memory limit is no lower than 4 GiB, except on machines up to ~16 GiB where it is the whole share minus the client. On this machine the engine gets 4 cores and 4 GiB, two engines: no multi-second stalls after edits or during warm-up (p90 ≤ 0.9 s). Six GiB instead of four would give another −0.3 s p90 after edits at the cost of a second engine on 32 GB — not taken. Not measured: two simultaneously busy engines, smaller machines, and other-size projects.
