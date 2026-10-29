---
id: 01a18547-5d06-7e98-8782-162e1411e8b9
title: Prove the trace transfer keeps the server loop under 50 ms, and measure desktop input lag during it
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18891-e436-7e82-91c1-5a7389680d7c",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a184dc-4fbe-7b01-a2d5-4fae5c99a890
---
The managed server's one-sample 50 ms ceiling is proved. Desktop native-input acknowledgement roundtrip and send-to-renderer-handler latency are measured separately: large transfers have a tail cost under concurrent load, so the result is not a claim of frame-transparent transfer. The analysis worker's own exposed heap counters were instrumented separately. No trace-payload producer fix follows from the measurements; the isolated earlier native/main callback interval remains unclassified.

## Machine and method

All new samples: Apple M2 Max, 12 logical CPUs, 32 GiB RAM, arm64, macOS 26.0.1 (25A362), Bun 1.4.4. Managed Chrome for Testing: 151.0.7922.71. Desktop: Electron 44.8.0, Chromium 152.0.7977.167, Node 24.22.0, V8 15.2.124.43-electron.0. The desktop display reported 120.000008 Hz (about 8.333 ms per frame). Natural concurrent work continued; no synthetic CPU burners were added. A shared moving HEAD is not an installed build: the measured trace producer blobs were `009f0d869e6fb2eee6fc6f494cf19902855e2c07` (`trace.ts`), `17514603fbb770f7a854ce4ee698cd73173dc5b9` (`analysis.worker.ts`) and `f9e45dc7a9b4e4f47aeb29d75b88a852cb4e236d` (desktop `driven.ts`).

The managed and desktop rigs use `PAGE.*.body.execute` and `TRACE.*.body.execute` through the existing fixtures and calling context. After a small load trace warms analysis, each large recording makes six batches of 100,000 Performance marks, stops, transfers, analyzes and reads the summary. These buffer-filled, mark-only traces answer `dataLoss: true` and no insight sets; they prove volume transport/analysis, not insight quality. Each new gzip trace is copied before teardown, and its uncompressed bytes are counted outside the timed stop.

The desktop rig uses the existing hidden Tagma test-host surface in the same Electron main as the traced page, not the operator's installed app. It measures 60 Hz native `webContents.sendInputEvent` keydowns, observed by `before-input-event`, a timestamp in the surface renderer's keydown handler, its console IPC acknowledgement in main, and the HTTP reply to the Bun driver. The acknowledgement roundtrip includes renderer-to-main console IPC, HTTP response and Bun JSON handling; send-to-handler latency ends at the renderer's handler. Neither is physical-keyboard-to-displayed-pixel latency. A 5 ms main timer records lateness and main-thread CPU; main and surface-renderer V8 CPU profiles span every idle and transfer window. Clock offsets are calibrated by eight request/reply exchanges and the minimum-RTT midpoint; final half-RTT bounds are 0.033–0.209 ms. Electron cumulative per-process CPU is sampled only outside the timed windows and includes profiler start/stop overhead. The first attempt to sample it every 20 ms itself took up to 38.948 ms and was rejected as perturbing evidence (`split-1`).

## Profiled managed samples

The original retained sample on 2026-10-29 at 03:26:11.652–03:26:19.654 UTC used HEAD `4e86fbee9d1c000fa2c77ce97fad9465db1bb15b`: 136,675,397 B uncompressed, 8,085,485 B gzip, stop 8,002.082 ms, collect 6,423.615 ms, analyze 1,562.743 ms, 1,470 ticks, maximum lateness 9.016 ms and zero LoopStalls above 50 ms. Its process memory counter rose from 115,114,896 to 683,329,120 B; that was not worker-only memory. End load was 5.59/29.18/63.10. Its rig, JSON and raw CPU profile remain in the scratch of [[01a185ad-5db5-78c2-b24b-f3953d460422|trace-lag]]; its gzip file was not retained before testbed teardown.

Three further samples kept CpuProfiler and LoopStalls active over the entire stop/transfer/analysis:

| Sample, UTC window | Uncompressed / gzip B | Stop ms | Collect / analyze ms | Ticks / worst lateness ms | Stalls >50 ms | Load before → after (1/5/15 min) |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 1, 16:53:00.118–16:53:12.363 | 136,674,682 / 8,011,818 | 12,245.243 | 9,290.256 / 2,934.491 | 2,151 / 22.473 | 0 | 4.421/5.899/5.986 → 5.720/6.131/6.067 |
| 2, 16:53:30.173–16:53:39.614 | 136,745,964 / 8,212,869 | 9,441.599 | 7,462.021 / 1,963.537 | 1,720 / 8.110 | 0 | 8.043/6.626/6.246 → 7.427/6.539/6.219 |
| 3, 16:54:17.086–16:54:26.207, heap-instrumented | 136,660,768 / 8,083,685 | 9,121.199 | 6,950.678 / 2,160.312 | 1,665 / 9.465 | 0 | 6.254/6.351/6.162 → 6.228/6.339/6.160 |

The additional three profiled samples did not reproduce a stall over 50 ms. Their materially lighter load does not reproduce the earlier four unprofiled 12/10/62/196 ms samples; the 62/196 ms pauses remain unattributed. Each sample retains its raw CPU profile and empty stall list. Process memory counters started at 121,783,136 / 118,834,040 / 116,638,560 B and reached 702,449,272 / 651,265,704 / 889,833,104 B respectively; these are whole-process observations, not worker heap.

## Analysis worker memory

Sample 3 bundles the actual analysis worker with scratch-only checkpoints at entry/import, every event-splitter batch, before/after model parsing, sidecar completion and a 2 ms worker timer. It read 516,497 events in nine batches and recorded 80 observations without forced GC. The observed worker-isolate high-water was 376,446,903 B (`process.memoryUsage().heapUsed`, 359.008 MiB); `heapStats().heapSize` reached 377,384,092 B (359.902 MiB), and heapTotal 398,993,408 B. This is the worker's own exposed heap-counter high-water, not an exact live-allocation peak: both used counters are last-GC-derived in Bun 1.4.4, and a timer cannot run inside a synchronous parse. The full heap census and bundling perturb this sample.

The Bun process-memory lifetime peak was 889,833,104 B (848.611 MiB), not worker RSS. On this macOS Bun build the `rss`/`bun:jsc.memoryUsage` counter is physical footprint, including compressed pages, rather than Unix RSS. The checked Bun interfaces expose no true isolate live-heap peak. Source semantics: [Bun 1.4.4 memory implementation](https://raw.githubusercontent.com/oven-sh/bun/bun-v1.4.4/src/jsc/bindings/BunProcess.cpp#L3931-L3976), [heapStats](https://bun.sh/reference/bun/jsc/heapStats), [whole-process memoryUsage](https://bun.sh/reference/bun/jsc/memoryUsage).

## Desktop interleaving

Final seed-1 run `split-2` interleaves four 3 s idle windows with three complete large trace stops in one fixture/main process. Seeds 2 and 3 (`split-3`, `split-4`) repeat idle/transfer/idle in fresh fixture processes. Columns are p50/p95/max in ms; maxima have unequal exposure because transfer windows last longer than idle windows. These are conditional measurements, not a guarantee across machines or load.

| Run/window | Duration ms | Inputs | Input-acknowledgement roundtrip p50/p95/max ms | Main loop lateness p50/p95/max ms | Load at start (1/5/15 min) |
| --- | ---: | ---: | --- | --- | --- |
| split-2 idle-1 | 3,001.069 | 179 | 0.744/4.247/18.537 | 0.632/1.352/11.328 | 11.308/12.813/10.407 |
| split-2 transfer-1 | 16,377.014 | 905 | 4.065/34.850/78.910 | 0.844/8.379/82.032 | 12.913/13.086/10.531 |
| split-2 idle-2 | 3,002.744 | 167 | 2.357/26.013/42.562 | 0.765/8.331/38.468 | 14.046/13.327/10.661 |
| split-2 transfer-2 | 18,098.698 | 998 | 3.617/33.689/128.619 | 0.879/9.282/78.930 | 13.270/13.184/10.641 |
| split-2 idle-3 | 3,002.136 | 173 | 1.889/12.730/32.197 | 0.758/6.151/16.209 | 14.598/13.471/10.787 |
| split-2 transfer-3 | 16,078.059 | 902 | 3.686/25.206/126.138 | 0.817/7.042/54.192 | 15.030/13.579/10.841 |
| split-2 idle-4 | 3,000.419 | 178 | 0.780/8.129/41.645 | 0.685/1.560/20.658 | 14.168/13.475/10.866 |
| split-3 idle-1 | 3,005.538 | 176 | 0.808/6.272/27.960 | 0.693/1.989/25.558 | 13.354/13.317/10.826 |
| split-3 transfer-1 | 10,734.623 | 621 | 1.593/13.566/55.520 | 0.709/4.567/36.241 | 12.765/13.196/10.797 |
| split-3 idle-2 | 3,000.122 | 179 | 0.709/2.072/27.441 | 0.678/1.086/15.788 | 11.762/12.956/10.753 |
| split-4 idle-1 | 3,000.321 | 175 | 0.820/13.942/78.075 | 0.694/2.382/19.802 | 11.220/12.824/10.719 |
| split-4 transfer-1 | 14,901.661 | 829 | 4.504/30.800/83.563 | 0.804/7.649/47.398 | 10.722/12.693/10.686 |
| split-4 idle-2 | 3,001.148 | 175 | 1.437/11.386/21.034 | 0.703/3.254/12.218 | 10.972/12.657/10.708 |

The send-to-renderer-handler metric excludes the acknowledgement/reply tail. From the same retained inputs, its p50/p95/max values are:

| Run/window | Send-to-handler p50/p95/max ms |
| --- | --- |
| split-2 idle-1 | 0.435/2.185/10.676 |
| split-2 transfer-1 | 2.125/19.182/75.800 |
| split-2 idle-2 | 1.434/15.482/27.873 |
| split-2 transfer-2 | 1.891/19.989/73.665 |
| split-2 idle-3 | 1.059/8.479/20.467 |
| split-2 transfer-3 | 1.753/15.954/88.406 |
| split-2 idle-4 | 0.487/3.199/25.551 |
| split-3 idle-1 | 0.498/4.771/27.229 |
| split-3 transfer-1 | 0.875/8.365/35.658 |
| split-3 idle-2 | 0.448/1.223/26.650 |
| split-4 idle-1 | 0.537/6.829/47.889 |
| split-4 transfer-1 | 2.259/17.370/52.927 |
| split-4 idle-2 | 0.810/6.440/14.773 |

The five traces were 102,014,451 / 102,675,483 / 102,690,233 / 102,040,357 / 102,025,028 B uncompressed and 7,508,449 / 7,575,248 / 7,610,100 / 7,452,940 / 7,621,290 B gzip. Every injected keydown was observed by the native hook and renderer. Input p95 is higher in the transfer arms than their neighbouring idle arms, so a claim of no transfer cost is not supported.

## Attribution and delivery

The split-2 second transfer's 128.619 ms worst input spent 13.568 ms before main admission, 0.081 ms in main before native dispatch, 23.062 ms reaching the renderer handler, 91.635 ms returning from that handler to main, and 0.274 ms returning to the Bun driver. The surface renderer's profile in its delivery gap was idle. Main's reply gap sampled native `emit` (13 samples) and idle (2), with about 27.080 ms main-thread CPU in overlapping timer intervals: this is not proof of OS scheduling. Another 126.138 ms input split into 26.674/0.067/27.797/47.391/24.208 ms across the same stages, with idle main and surface-renderer profiles and 2.131 ms main-thread CPU in overlapping intervals.

Across the five final transfer brackets, GPU CPU was 0.406–4.123 ms, while the Chromium Tracing Service used 6.491–7.638 CPU seconds. The window renderer was not a sampled CPU hog in the measured tail gaps; GPU CPU contention is not supported by these brackets. Native tracing work is a real concurrent cost. The profiles do not distinguish a native wait/IPC delay from runnable-but-unscheduled time, so the records do not label every idle gap OS scheduling.

The 96 KiB IO.read request yields at most 131,072 base64 characters per answer. Direct timing of the actual Driven reply fulfillment includes JSON.stringify and report sending; those IO.read callbacks stayed below 1.625 ms CPU in the five final transfers. The five transfer windows retained 484 actual reply fulfillments. Two tiny Runtime.releaseObjectGroup replies took 12.388 and 10.120 ms CPU, so the IO.read bound is not a bound over all native replies. An earlier exploratory 54.392 ms timer gap had 31.083 ms loop CPU and 14/15 samples in Driven's reply callback, without retained per-method timing; the method/cause cannot be reconstructed from that profile alone. It did not establish a large-payload cause, and reducing the IO.read size is not a demonstrated remedy. The additional macOS sample did not identify a producer inside that earlier interval.

## Exploratory desktop figures

Before the final stage-split/interleaved rig, five complete large desktop recordings established the tail that required attribution. They did not timestamp the renderer handler, so their acknowledgement tail cannot be retrospectively called handler latency. Values below are p50/p95/p99/max in ms. `desktop-3` completed its measurement assertions but failed the already-closed-page cleanup described below; its observations remain measurements, not a passing test. The earlier `desktop-1` calibration had a gzip-versus-uncompressed size assertion error and included profiler-start work in its first loop tick, so it is excluded from acceptance figures.

| Exploratory window | Duration ms / inputs | Ack roundtrip p50/p95/p99/max ms | Main lateness p50/p95/p99/max ms |
| --- | ---: | --- | --- |
| desktop-2 idle | 2,000.899 / 119 | 0.880/2.487/15.662/19.587 | 0.689/1.316/3.044/17.262 |
| desktop-2 transfer | 7,426.672 / 438 | 0.801/5.658/13.876/31.617 | 0.682/1.499/8.387/36.805 |
| desktop-3 idle | 2,001.175 / 113 | 1.723/12.821/22.750/38.447 | 0.776/5.957/13.697/27.408 |
| desktop-3 transfer | 26,870.023 / 1,484 | 3.487/37.191/66.557/192.880 | 0.935/9.218/20.438/140.722 |
| desktop-4 idle | 2,002.289 / 113 | 1.966/13.108/21.118/37.013 | 0.835/7.662/15.689/32.436 |
| desktop-4 transfer | 14,486.198 / 822 | 2.101/30.509/45.649/84.434 | 0.770/7.172/15.931/95.575 |
| desktop-5 idle | 2,001.490 / 116 | 1.628/20.484/50.722/56.093 | 0.719/5.282/14.290/28.959 |
| desktop-5 transfer | 11,866.398 / 687 | 1.617/11.150/30.292/54.910 | 0.753/3.704/11.845/56.716 |
| desktop-6 idle | 2,000.321 / 112 | 2.472/22.716/57.814/64.057 | 0.782/6.722/20.542/28.638 |
| desktop-6 transfer | 12,149.766 / 693 | 1.990/23.835/107.083/214.377 | 0.770/5.861/14.443/148.206 |

Those five traces were 102,037,269 / 102,059,266 / 102,060,603 / 101,968,491 / 102,039,756 B uncompressed and 7,360,798 / 7,585,321 / 7,562,221 / 7,652,094 / 7,572,009 B gzip. In the last three exploratory transfers the directly instrumented reply-fulfillment CPU maxima were 1.060/0.925/0.540 ms; the first had 97 measured callbacks and an IO.read maximum elapsed time of 6.688 ms. A 36.805 ms timer gap in desktop-2 sampled idle (3/3) and used 3.957 ms process CPU; a 140.722 ms gap in desktop-3 used 2.056 ms loop CPU. These narrowed the question but did not identify OS scheduling or eliminate renderer/IPC waits; the final split method above resolves those boundaries.

## Native sample and buffer pair

One additional same-rig run (`native-1`, seed 1) passed with a macOS sample of Electron main. The sampler began about 25 s after launch and retained an aggregate 3,410 CrBrowserMain observations, including 3,070 in Mach-port waiting. Its nearest-export native symbols and anonymous JIT frames are not precise symbolication and have no per-stall timeline; they cannot retrospectively identify the earlier 54.392 ms callback. This is additional sampled-load evidence, not a source attribution.

| Native run/window | Inputs | Ack roundtrip p50/p95/max ms | Send-to-handler p50/p95/max ms | Main loop lateness p50/p95/max ms |
| --- | ---: | --- | --- | --- |
| idle-1, 3,000.211 ms | 177 | 0.870/6.588/27.830 | 0.568/4.112/19.077 | 0.689/1.721/20.987 |
| transfer-1, 13,483.389 ms | 730 | 2.079/50.003/229.247 | 1.144/29.042/133.474 | 0.754/9.716/161.171 |
| idle-2, 3,000.201 ms | 179 | 0.655/1.257/3.582 | 0.477/0.798/2.227 | 0.647/0.932/3.585 |
| transfer-2, 7,582.434 ms | 444 | 0.734/6.514/35.746 | 0.531/3.661/25.778 | 0.683/1.860/39.378 |
| idle-3, 3,000.112 ms | 176 | 0.751/9.977/44.549 | 0.568/5.901/34.399 | 0.688/2.150/26.769 |
| transfer-3, 10,948.830 ms | 622 | 1.532/26.795/115.500 | 0.993/16.839/92.289 | 0.705/6.931/97.234 |
| idle-4, 3,001.077 ms | 179 | 0.784/3.135/9.186 | 0.568/1.973/8.752 | 0.669/1.158/8.494 |

Those three traces were 102,347,938 / 103,027,329 / 103,037,184 B uncompressed and 7,548,880 / 7,571,593 / 7,551,667 B gzip. Their Tracing Service CPU brackets were 5,611.701 / 5,261.280 / 6,519.447 ms. Full before/after loads are retained per window; starting loads of the transfer arms were 8.476/10.399/10.126, 10.251/10.717/10.245 and 9.333/10.486/10.170.

The parent requested a cheap paired producer experiment, without changing the product. A scratch-only Bun preload (`buffer-preload.ts`) makes the warmup and three large starts use 64/64/16/64 MiB, keeping gzip, the page workload and analysis unchanged. The 16 MiB arm explicitly has a 10 MiB volume assertion instead of the normal 50 MiB assertion; this is an experimental different precondition, not acceptance evidence for the original >50 MiB target. Exact source and buffer assumptions are checked by the preload. The seed-1 A/B/A run passed all 24 expectations; no product default or source changed.

| Paired window, buffer | Duration ms | Inputs | Ack roundtrip p50/p95/max ms | Send-to-handler p50/p95/max ms | Main lateness p50/p95/max ms |
| --- | ---: | ---: | --- | --- | --- |
| idle-1 | 3,000.271 | 179 | 0.793/4.161/13.671 | 0.528/2.370/11.416 | 0.704/1.490/9.745 |
| transfer-1, 64 MiB | 7,283.032 | 433 | 0.721/2.624/34.849 | 0.475/1.747/14.784 | 0.681/1.214/19.352 |
| idle-2 | 3,000.737 | 178 | 0.747/2.743/16.022 | 0.490/1.925/10.164 | 0.686/1.344/15.591 |
| transfer-2, 16 MiB | 2,838.191 | 160 | 1.717/23.875/60.901 | 1.013/16.421/36.368 | 0.749/8.760/27.494 |
| idle-3 | 3,015.046 | 169 | 2.414/37.420/101.821 | 1.576/21.634/96.731 | 0.887/8.875/108.805 |
| transfer-3, 64 MiB | 24,251.957 | 1,284 | 3.969/58.831/289.441 | 2.120/37.548/267.253 | 0.921/12.821/282.461 |
| idle-4 | 3,000.106 | 177 | 1.030/9.587/35.450 | 0.634/6.078/26.912 | 0.691/2.590/12.098 |

| Arm | Uncompressed / gzip B | Retained events / recorded duration ms | Tracing Service CPU ms | dataLoss | Start load (1/5/15 min) |
| --- | ---: | ---: | ---: | --- | --- |
| 64 MiB A | 102,037,819 / 7,482,133 | 301,813 / 667.6 | 5,025.433 | true | 9.038/8.853/9.294 |
| 16 MiB B | 22,852,469 / 2,435,956 | 51,765 / 220.1 | 1,340.012 | true | 8.259/8.682/9.225 |
| 64 MiB A | 102,796,312 / 7,693,836 | 304,701 / 1,838.4 | 7,798.633 | true | 9.420/8.908/9.298 |

Reducing the buffer cut native tracing CPU, saved bytes, event retention and total stop time, but input p95 did not track that CPU monotonically: the 16 MiB arm was slower than the first 64 MiB control and faster than the returning control, while the idle baseline itself changed sharply. This one pair therefore does not isolate serialization/gzip contention as the cause of input tails or justify a new product knob. The knob's actual trade-off is earlier/more data loss against lower trace volume and native work; this experiment does not establish its input-lag benefit. No follow-up task was created under the parent's conditional instruction, because its stated correlation was not established. Collect/analyze phase spans were not separately instrumented in this pair; total stop time and CPU brackets are shown, while the managed samples above retain exact phase spans.

## Checks and artifacts

Final split rig checks: seed 1 (three transfers), seed 2 and seed 3 all passed, with 24/10/10 expectations. Earlier exploratory desktop runs and the rejected periodic-metrics run remain in scratch, separate from the final table. A seed-2 exploratory run completed all eight measurement assertions but its unconditional close finalizer failed `page-unknown`; cleanup was corrected to the existing trace-scenario contract, checking whether the host had already closed the page. The mock-keychain omission in the existing test host was reported to desktop-engine, which added the switch in its own delivery. The temporary scratch import is removed after captures; the running Tagma server was untouched.

All new managed evidence is retained in [[01a18892-f274-70a4-8345-072308d729fc|trace-server-samples]] scratch (`evidence.json`, `summary.json`, rigs, all gzip traces, raw ticks/spans/stalls/profiles and worker heap rows). Desktop evidence is retained in [[01a18891-e436-7e82-91c1-5a7389680d7c|trace-desktop]] scratch (`desktop-lag.itest.ts`, `main-probe.ts`, `split-summary.ts`, `split-summary.json`, each window's raw JSON and main/renderer .cpuprofile, gzip traces, and exact bundled hosts). The per-window JSON retains all stage percentiles, full load values, callbacks and CPU brackets. `native-1-main.sample.txt`, `buffer-preload.ts` and `buffer-events.json` retain the native attempt and paired experiment. Independent review by [[01a188ae-dc48-7ff3-9f4d-9d75beba739d|trace-lag-review]] found one claim-label issue: the acknowledgement roundtrip had been described as handler latency. The record now names both metrics separately and derives the handler-arrival distributions from existing stage timestamps; no new capture or source fix was needed. The review found no evidence supporting an IO chunk-size remedy, OS-scheduling diagnosis or frame transparency.

No repository source change remains from this measurement work, so there is no code commit to attribute. The required combined seed-1 desktop-engine/managed-engine/screencast run subsequently passed: 71 tests, 0 failures, 504 expectations, 71.8 s wall, verified in `/Users/teunlao/.tagma-dev/scratch/01a18891-e427-7409-8fbe-8d377d975d98/seed1b.txt` (testbed report `/tmp/runlith-test/reports/run.32872.1793295631445.jsonl`). [[01a18891-e427-7409-8fbe-8d377d975d98|desktop-engine]] reports that an earlier run hung once in the desktop beforeunload-navigation scenario; four later isolated runs passed, but its cause remains unproved. This green run does not establish that the earlier hang is fixed. The desktop source delivery owns its server/desktop typechecks; it reports errors in peers' in-progress files, so no overall green typecheck is claimed here.
