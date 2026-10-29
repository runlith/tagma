---
id: 01a163dd-cbb5-733d-a5f4-7da10c5ff859
title: "tsc-rs and tsgo on runlith: three navigation repeats, edit price and exact worktree layers"
ord: 2
edges:
  - kind: discovered-from
    to: 01a163a2-6386-7fab-80e4-e95e47c48af3
---
## Conclusion

For the fork, tsc-rs is recommended in normal mode: on this runlith after a load of three worktree layers, the first heavy question after an edit took 3.13 s versus 10.00 s for tsgo, and three exact worktree layers took 6.51 versus 9.05 GiB of physical memory. On a warm adapter tsgo is slightly faster; a full warm kit question is close on both sides. `GOPORT_FAST=1` gave no convincing extra navigation speedup: 53 versus 54 ms p50 directly, 592 versus 601 ms through the kit. It cut the three exact layers' memory by about 0.49 GiB more.

This is an engine recommendation for a further fork, not confirmation that the binary is ready to simply replace in the delivery: tsc-rs ignores the `GOMEMLIMIT` and `GOGC` currently passed. Until memory control moves over, the working limit on the native process stays only with tsgo. The experiment changed no product code and made no migration decision.

## Conditions and reproduction

One sample: macOS 26 / Darwin 25.0.0, arm64, 12 logical CPUs, 32 GiB RAM, Bun 1.4.3. At the final events, one-minute load average was 4.57–20.14; the machine was not isolated from other agents, applications, and background Tagma inspections. `loadavg()` was recorded at each event; there is no continuous load recording. The OS file cache was not cleared. In the first fixed run, Rust had a 57 s load outlier; it is kept in the range, its cause is not established.

The base was a separate detached runlith worktree at `0446694c13d25692abca7b394bd83f14e1c71b11`; `bun install --frozen-lockfile --ignore-scripts --concurrent-scripts 1`, the base's tracked files unchanged. Worktrees w1–w3 of the same commit differed by an added exported constant in `packages/agent/src/thread/conformance/transitions.ts` and `apps/tagma/server/src/threads/notes/owner.ts`. That forces the programs of both areas to rebuild with no benchmark-line shift. In a separate write-acceptance check, the full engine received a new generated file `packages/agent/src/thread/conformance/navRustProbe.ts` with a `runTransition` call; the file was deleted between runs.

All scenarios live in `~/.tagma-dev/scratch/01a163a2-bca3-7caa-b201-d8c12348ae1a/`:

- `probe.ts` — client compatibility with both binaries;
- `bench.ts` — the real launcher and `engineProcess.ts` process, kit with ripgrep, separate adapter-call time inside a question; memory is the engine-client and native-compiler process tree;
- `direct.ts` — `makeSemantics` directly over the API, pre-found positions of seven names; no holder queue and no warmup-layer guard refusal. 98 live tsconfigs, no archive; the full engine's stock catalog holds 114 configs. The two stands' memory must not be compared as one level;
- `summarize.ts`, `summary.json` — summary; raw records `results-{rust,fast,go}-{A,B,C}.json` and `direct-{rust,fast,go}-{B,C,D}.json`;
- `vendor/` — a separate npm install; `ts-rust/` — a shallow reference with the published package's fetched commit.

For the full stand: `NODE_PATH=/opt/workspaces/runlith/node_modules GOPORT_FAST=0 bun <scratch>/bench.ts rust A`; the `go` variant picks the Go binary, `fast` with `GOPORT_FAST=1` picks Rust. For the direct stand: `GOMAXPROCS=3 GOGC=50 GOMEMLIMIT=9663676416 GOPORT_FAST=0 bun <scratch>/direct.ts rust B`. The working directory is `packages/navigation-ts`. The full stand's launcher sets the same three CPUs, `GOGC=50`, `GOMEMLIMIT=9 GiB`; `process.limit` gets 10 GiB, but the headroom check for a new layer takes the smaller, i.e. 9 GiB. The direct stand has no layer headroom check, but Go still gets its 9 GiB soft limit. So "without budget" below means no layer-budget allowance, not Go with infinite native budget.

Full stand: three repeats per side, order A: Rust/Go/fast, B: Go/fast/Rust, C: fast/Rust/Go. Direct stand: three final repeats per side B/C/D; D ran fast/Rust/Go. Engines never ran together. Pilots `results-*-1.json` on a moving main and `direct-*-A.json` with a different edit-verification sequence are excluded from the summary. Full B/C and direct B/C ran as sequential pairs per side. The longest command was about 7 min 21 s; the 10 min limit was never exceeded. Temporary worktrees were cleaned and deleted after measurement with no new commits; delete_worktree left links to the detached checkout's source commit. Scripts and JSON stay in scratch. The change record after deletion: 0 held paths.

## Versions and compatibility

- tsc-rs **0.8.0**, npm gitHead `4c032be6dbef6dafaae2358ece165d138f8e0da8`; the binary answers `Version 7.1.0-dev`.
- tsgo — **typescript@7.1.0-dev.20261008.1**, gitHead `fed0bf24149fb1ed3603926afbfdac1ea10e`, i.e. the pin of tsc-rs, not the beta installed in the product. Stock `lib.*.d.ts` catalogs were compared with `diff -qr`: only the `tsc` executable differs.
- SHA256 Go: `3c61fc74c866133e927bd6e78f5bfa4d7a718fab246`; Rust: `a339af800cf53321620a2e1bf281fdbf4c6e8a4f`.
- Both final stands used the existing JS client **typescript7 7.1.0-beta**, gitHead `3e9236361fa97a9e6c685f4833ac457ae2d8c50a`. Only the `compiler` path changed, no product code edited. Start, first snapshot, questions, file layers, and snapshot releases work with both binaries.
- `probe.ts` separately checked the current beta and matched dev JS client against each binary: `createSnapshot` for agent, one program, 1372 sources in all four combinations. The full benchmark with a matched JS client was not separately repeated: it was not needed for the current adapter. That is a check of the API subset we need, not proof of whole-API compatibility.

The pin is confirmed by [UPSTREAM.md of the published revision](https://github.com/pingdotgg/ts-rust/blob/4c032be6dbef6dafaae2358ece165d138f8e0da8/UPSTREAM.md). `UPSTREAM.json.current` in the reference stays historical; its value was not used as the build pin.

## Measurements

Cells with no p50/p90 hold the median of three runs and the min–max range. Warm quantiles are computed over 42 answers: 7 symbols × 2 warm rounds × 3 processes. Those are 42 questions, not 42 independent machine samples.

| Check | tsc-rs | tsc-rs fast | tsgo |
|---|---:|---:|---:|
| Base: benchmark | 74/74 | 74/74 | 74/74 |
| Own w1 snapshot: benchmark | 74/74 | 74/74 | 74/74 |
| First served snapshot, s | 5.25 (5.01–57.06) | 5.51 (4.69–13.63) | 10.01 (6.88–11.53) |
| First answer from process start, s | 13.03 (13.03–88.06) | 13.53 (11.84–21.84) | 25.87 (22.07–29.76) |
| First question itself after load, s | 7.85 (7.61–30.44) | 7.86 (6.99–8.04) | 15.10 (14.25–19.62) |
| Warm adapter directly, p50 / p90, ms | 54 / 138 | 53 / 132 | 46 / 109 |
| Adapter inside the process, p50 / p90, ms | 65 / 165 | 55 / 145 | 57 / 166 |
| Whole warm kit question, p50 / p90, ms | 601 / 955 | 592 / 870 | 633 / 1007 |
| New raw snapshot after editing an existing file, update, ms | 12 (11–14) | 12 (11–17) | 16 (14–34) |
| First heavy `stop` on the new raw snapshot, s | 3.13 (2.86–3.58) | 2.91 (2.90–3.13) | 10.00 (9.61–10.83) |
| Next full answer right after the write, ms | 292 (137–298) | 267 (131–426) | 289 (262–289) |
| Time from touch to accepted-edit check, s | 2.01 (1.92–3.08) | 1.93 (1.90–2.31) | 2.12 (2.01–2.49) |
| First full question after acceptance, ms | 218 (136–453) | 142 (132–192) | 171 (164–284) |
| After 31 s: raw adapter, ms | 126 (85–226) | 122 (117–126) | 142 (133–154) |
| After 31 s: adapter inside the process, ms | 73 (70–291) | 92 (63–140) | 65 (56–138) |
| After 31 s: whole kit question, ms | 3169 (954–16041) | 2387 (960–2421) | 1825 (986–2785) |

Time of the first answer from launch includes the service memory sampling after initial load. The question's own time is also given to separate it honestly from that insertion. Small tens-of-ms differences on this machine are not causally separated from background load.

Warm-quantile spread over three processes (14 questions each): raw p50 Rust 54–55, fast 53–58, Go 44–50 ms; raw p90 131–203 / 131–146 / 106–115 ms. Kit p50 532–676 / 487–661 / 610–734 ms, p90 877–1270 / 862–903 / 983–1359 ms respectively. Warm-kit difference is small against that spread; a multiple-fold speedup of the full warm question is not confirmed.

The heavy raw question after an edit was taken after warming three layers and releasing w2/w3; the previous w1 snapshot stayed held until the new one was checked. Go then stayed under the 9 GiB soft limit and close to it by footprint. That is the price of that stated accumulated state, not a measurement of one isolated edit on an empty engine.

Right after the write, all three variants showed the new call's line as `changed`, not a confirmed place. After warmup the call confirmed in all runs. The direct test changed an existing file's contents through `fileSystem.files`: the next question on the new snapshot saw the new call. This stand does not prove the base snapshot's isolation: the negative control did not pass the new call's position for the base to `judge`, so its `visible:false` is no proof against a leak. That method defect was found by independent review; no new runs followed the stopped series. The full test created a new file, so its accept time must not be issued as the raw test's existing-file change time.

After 31 s the API stayed warm on all sides. Multi-second full answers stayed outside the measured adapter calls; the stand did not split the remaining time into ripgrep launch, file reads, and kit processing. The 16 s Rust outlier's cause is not established. Swapping one compiler did not prove those pauses away.

## Memory and worktrees

Everywhere GiB, the sum of `phys_footprint` of the process tree, including the JS client. That is the process's physical price with allocator-held pages, not the live heap. Peaks are maxima of samples taken during warmup, not a continuously measured absolute maximum.

| State | tsc-rs | tsc-rs fast | tsgo |
|---|---:|---:|---:|
| Full engine: after load | 2.89 (2.89–2.89) | 2.88 (2.88–2.89) | 2.87 (2.85–2.91) |
| Full engine: after base rounds | 5.24 (5.20–5.30) | 5.08 (5.05–5.12) | 5.32 (5.21–5.51) |
| Full engine: 1 attached worktree | 6.80 (6.21–6.82) | 6.59 (6.56–6.61) | 6.61 (6.59–6.61) |
| Full engine: 3 attached worktrees | 6.32 (6.27–7.16) | 6.14 (6.13–6.14) | 6.50 (6.50–6.51) |
| Full engine: sampled peak at accepting the write in w1 | 6.44 (6.43–6.72) | 6.58 (6.32–6.60) | 6.61 (6.59–6.61) |
| Raw: after load | 2.57 (2.57–2.58) | 2.56 (2.56–2.57) | 2.58 (2.56–2.65) |
| Raw: after base rounds | 3.94 (3.93–3.94) | 3.81 (3.77–4.11) | 6.08 (5.88–6.16) |
| Raw: 1 exact worktree layer | 4.51 (4.48–4.58) | 4.29 (4.27–4.49) | 6.49 (6.40–6.57) |
| Raw: 3 exact worktree layers | 6.51 (6.45–6.59) | 6.02 (5.98–6.12) | 9.05 (8.98–9.06) |
| Raw: sampled peak of the new snapshot after releasing w2/w3 | 6.44 (6.31–6.56) | 6.00 (5.91–6.01) | 9.09 (9.08–9.09) |

In the full engine, three attached worktrees do not mean three exact snapshots. For Go and fast, only w1 got its own snapshot in all three processes. For plain Rust, w1 in all processes and w2 only in A. The rest answered from the base snapshot: 70 of 74 benchmark places confirmed, four benchmark places in that worktree's two files standing `changed`. So the full engine's low memory must not be read as the price of three exact layers. The raw stand genuinely held and checked all three layers: 74/74 on each.

Lower final memory with three attached worktrees than with one is possible: between those points w1 survived a snapshot replacement and an old release, and the allocator returned pages. Those are different states in time, not a measurement of a new worktree's negative price.

Per [runtime.rs:9–34](https://github.com/pingdotgg/ts-rust/blob/4c032be6dbef6dafaae2358ece165d138f8e0da8/crates/ts_goport/src/runtime.rs#L9-L34), Rust has no Go GC: `GOGC` and `GOMEMLIMIT` do nothing. `GOMAXPROCS` sizes parts of the pools. No found analogue of the current native-process soft memory limit was found in the API read; holder-side snapshot release and budget allowance do not replace limiting the native process itself. Exceeding the limit and behavior under artificial OOM were not separately checked.

## What GOPORT_FAST changes

Verified by reading the exact npm gitHead, not just the README. In `--api` the switch acts through `GOPORT_FAST=1`; the `--fast` CLI flag parses after the move into API/LSP and is not needed for this launch. It turns on together: more checkers, lazy member tables, a fast intersection-check order with `never`, separate jemalloc checker arenas. Work-stealing distribution and experimental cost split are off by default. [fast_mode.rs](https://github.com/pingdotgg/ts-rust/blob/4c032be6dbef6dafaae2358ece165d138f8e0da8/crates/ts_goport/src/fast_mode.rs).

The fast checker count takes `std::thread::available_parallelism()`, not `GOMAXPROCS`, max 16 and min 4, bounded by file count. On this 12-core machine that can yield up to 12 checkers despite `GOMAXPROCS=3`; actually loading all those threads at once was not measured. So the same environment variable does not prove the same CPU budget for fast.

The mode changes algorithms, not just the allocator: the exact revision's README names diagnostic differences for type cycles and instantiation limits. Our navigation benchmark and file layers were not hurt by it, but that is no proof of equivalence for any navigation question. On our series, fast saved about 8% of three exact layers' memory versus plain Rust, with no convincing extra question speedup.

## Result boundary

The benchmark measures completeness of 74 known places of seven symbols; specificity of all other verdicts was not separately checked. Extra `rowsOver` alias declarations are outside the call benchmark, so comparing the full line count to 74 is no false-place count.

The `fileSystem` layer checked uses two changed files and an added call. Deletions, diverging lockfiles/dependencies, symlink swaps, all custom FS callbacks, cancellation, and multi-threaded API load were not in this measurement. Four FS-callback list divergences mentioned in the author's fresh README were not reproduced and are not equated with our file layer. The exact npm gitHead's README section lacks those numbers yet. The author's numbers were not used for the choice.

Other machines, repositories, and platforms, live heap versus allocator garbage, CPU-seconds, long multi-user load, and full API compatibility were not measured. The no-`GOMEMLIMIT` Go variant did not run: the raw lines characterize no layer-budget allowance, not an infinite native budget. The Rust recommendation rests on the cold-recompute cost and exact layers in this sample; switching engines barely sped the warm kit answer up.
