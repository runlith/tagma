---
id: 01a183a3-4660-76fa-a14f-ef2390d98de3
title: "Code-editor bench migration: two old/new pairs and corrected renderer trace"
ord: 1
---
The four alternating comparison runs completed in order old, new, old, new on an Apple M2 Max (12 cores, 32 GiB, Darwin 25.0.0). Each run printed the full measurement JSON in its command record. The old program used installed Chrome 156.0.8078.49; the new program used pinned Chrome for Testing 151.0.7922.71. Each measured 800 typed keys, the 30k cold and three warm opens, and 50 clean/50 unsaved remote edits. Other agents held browser and Simulator launches for these four runs. The machine was not idle: the pre-run load samples below were all at normal memory pressure, and the sampling tool reported project 39 unavailable. These are two migration samples, not proof of performance equivalence across browser versions or machine loads.

| Run | Command execution (:167) | Busy | Available memory | Command wall |
| --- | --- | --- | --- | --- |
| old 1 | 16276d4f-2b6c-4390-a36a-5e9b3a54b3f0 | 29.6% | 8.8 GB | 74 s |
| new 1 | 17e1903b-c7ea-41fb-8612-e3b34a5c8385 | 43.6% | 9.4 GB | 30 s |
| old 2 | 685cbe14-cbdd-425f-b411-624e337097e0 | 37.4% | 8.5 GB | 49 s |
| new 2 | 66d7d1b9-90d9-478b-a222-912ccad47b44 | 26.6% | 8.5 GB | 29 s |

Old command: `CHROME_ARGS=--use-mock-keychain bun stand/bench.ts`. New command during side-by-side comparison: `../../node_modules/.bin/testbed e2e --program stand/bench-next.ts`. Both ran in `packages/code-editor`; the new file was renamed to `stand/bench.ts` after comparison. Both new runs held two of eight testbed process units and produced run reports. Their reports are `/tmp/runlith-test/reports/run.97595.1793209459073.jsonl` and `/tmp/runlith-test/reports/run.1576.1793209557783.jsonl`.

All timings below are milliseconds. Each cold-open cell is mount / first frame / coloured. Each warm-open list keeps run order.

| Run | Cold 30k | Warm 30k mounts | Warm first frames | Warm coloured |
| --- | --- | --- | --- | --- |
| old 1 | 26.4 / 36.4 / 227.3 | 6.7, 5.6, 5.5 | 12.6, 18.6, 16.6 | 26.6, 30.2, 31.2 |
| new 1 | 41.3 / 53.7 / 381.3 | 7.4, 5.5, 5.5 | 12, 9.3, 9.2 | 25.5, 26.4, 29.6 |
| old 2 | 31.6 / 42.2 / 234.3 | 7.2, 5.6, 5.6 | 15.2, 16.8, 10.4 | 44.4, 30.5, 22.6 |
| new 2 | 34.6 / 45.7 / 236 | 7.1, 5.7, 5.4 | 12, 9.5, 9.1 | 27.9, 24.6, 26.4 |

Each typing list is 1k / 100k / 100k+marks / textarea. The duration sample count is Event Timing's reported count, not the 200 injected keys per case.

| Run | Input p95 | Input duration sample counts | Input over 16 ms | Main-task p95 | Main-task counts |
| --- | --- | --- | --- | --- | --- |
| old 1 | 24 / 16 / 32 / 16 | 93 / 90 / 200 / 49 | 6 / 3 / 171 / 0 | 1.43 / 0.96 / 1.31 / 0.49 | 7613 / 5238 / 5658 / 3510 |
| new 1 | 32 / 32 / 24 / 16 | 200 / 200 / 200 / 187 | 169 / 178 / 198 / 7 | 1.61 / 0.9 / 1.37 / 0.48 | 6275 / 6070 / 5835 / 3698 |
| old 2 | 24 / 24 / 32 / 16 | 100 / 97 / 200 / 51 | 5 / 8 / 169 / 0 | 1.64 / 0.9 / 1.3 / 0.54 | 7085 / 5890 / 5340 / 3513 |
| new 2 | 32 / 32 / 32 / 24 | 200 / 200 / 200 / 189 | 171 / 185 / 199 / 13 | 1.81 / 0.95 / 1.32 / 0.03 | 6518 / 5886 / 6516 / 32 |

All four runs reported zero RunTasks above 16 ms and zero conflicts in both remote-edit cases. Remote sync p50 / p95 / p99:

| Run | Clean 100k | Unsaved 2000 lines on 100k |
| --- | --- | --- |
| old 1 | 0.8 / 2 / 3 | 2.1 / 2.4 / 4.5 |
| new 1 | 0.7 / 2 / 3 | 2.1 / 2.3 / 6 |
| old 2 | 0.7 / 1.7 / 2.7 | 2.1 / 2.6 / 4.8 |
| new 2 | 0.7 / 1.8 / 3.2 | 2.1 / 2.3 / 5.1 |

The new-2 textarea task count (32 versus approximately 3500 in the other comparable samples) exposed the inherited selector's ambiguity: it chose the first `CrRendererMain` metadata row, not the renderer of the measured page. The migrated bench is corrected to resolve its actual CDP page frame through `TracingStartedInBrowser` frame-to-process metadata before selecting the main thread; missing identification now fails rather than reporting a different renderer's tasks. The four rows above remain pre-fix evidence. The kit's native-scrollbar change was committed as f37aed44f7 during new-1; the second pair certainly ran after that commit. A post-fix correctness run of final `bun run bench` completed with exit 0 under testbed: 30.2 s wall, 28.4 s CPU, two of eight process-budget units, report `/tmp/runlith-test/reports/run.10194.1793209802437.jsonl`. Before that run the machine was 31.6% busy with 9.5 GB available, normal pressure; concurrent functional checks were allowed, so this run is correctness evidence, not a quiet comparison. Cold mount / first frame / coloured: 36.4 / 48.9 / 248.3 ms. Warm mounts: 6.8, 6, 5 ms. Typing main-task counts: 7398 / 6142 / 7454 / 3630; p95: 1.5 / 1.01 / 1.3 / 0.42 ms; no task exceeded 16 ms. Input p95: 32 / 32 / 32 / 16 ms. Remote clean p50 / p95: 0.8 / 1.9 ms; unsaved p50 / p95: 2.1 / 2.6 ms; neither reported a conflict. Page frame resolution succeeded for all four typing cases.
