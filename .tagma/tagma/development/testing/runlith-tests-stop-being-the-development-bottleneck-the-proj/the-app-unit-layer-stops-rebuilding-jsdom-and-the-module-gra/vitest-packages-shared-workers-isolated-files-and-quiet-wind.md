---
id: 01a16be4-12eb-7c4b-bc5a-6ac08bdd211f
title: "Vitest packages: shared workers, isolated files and quiet-window measurement commands"
ord: 4
---
Measurements of 2026-10-24, Apple M2 Max, 12 cores, 32 GiB, macOS; Vitest 4.1.11. Packages checked sequentially. maxWorkers: 2. testbed setupFiles/globalSetup kept. Optimizer off. A: former per-file isolation without fsModuleCache; B: shared workers with an isolated project for globals/module doubles and fsModuleCache in git-ignored node_modules/.vitest-module-cache. Columns are Vitest's printed counters, not non-overlapping CPU/wall intervals. With shared workers, Vitest double-counts environment, as in the app measurement. Wall below is external /usr/bin/time, Vitest duration in parentheses. Each sample is one run on a shared machine; A/B comparison only of adjacent alternating runs, B with a warm cache. While other agents change the imported testbed, part of the cache may invalidate. Scripts keep testbed; --randomize temporarily removed by the launching agent's decision, shuffle checked with an explicit CLI.

| Package | Run | Wall, s (Vitest) | Tests, s | Import, s | Environment, s | Transform, s |
|---|---|---:|---:|---:|---:|---:|
| layer | Original baseline, seed 1625317968, 2 fixture failures | 13.60 (12.98) | 3.96 | 3.01 | 14.48 | 1.46 |
| layer | B cold | 70.12 (61.48) | 13.75 | 38.68 | 194.86 | 36.59 |
| layer | B warm, right after cold | 61.06 (50.63) | 14.15 | 9.49 | 227.26 | 7.22 |
| layer | A1, fixtures fixed | 80.49 (73.85) | 17.11 | 40.72 | 64.59 | 26.57 |
| layer | B1 warm | 32.61 (29.33) | 6.19 | 8.28 | 213.62 | 4.99 |
| layer | A2, 1 ssr.test.ts failure, sample not green | 275.90 (263.60) | 27.47 | 99.71 | 326.84 | 54.05 |
| layer | B2 warm | 48.82 (41.89) | 8.94 | 19.88 | 216.99 | 18.63 |

layer: 29 files, 225 tests. In unit-isolated 3/29: src/cookies.test.ts stubs document/location; src/sveltekit/index.test.ts uses vi.mock $app; src/sveltekit/ssr.test.ts — vi.mock esm-env/$app and vi.stubGlobal browser globals. Other 26 shared. The chunk-conditions fixture waits for app.ready so the cold dynamic import sets the condition before the Gate changes; one flush is not enough. The absolute chunkLoads.count===1 removed in flagged-feature: the shared counter covers three different imported chunks and depended on order; the no-load-before-enable and reuse-after-disable checks kept. Seeds 42,1729,8675309: 29/225, all green; --isolate 29/225 green; typecheck 0 errors, 12 existing Svelte warnings. Isolated run before overload: 28.45 s Vitest, tests 5.27, import 5.27, environment 35.51, transform 1.43. Between cold/warm and A1 the machine reached 99.8% busy; further A2/B2 ran under high competing load. The adjacent green pair A1/B1 sped 80.49→32.61 s; the failed A2 confirms no speedup factor. A2's exact failure output lost to the filter: the failure cause undetermined, cannot be called a proven timeout.

Configuration delivery recorded in three commits: d297d4510b — layer/query/primitives; ab42e15d69 — chat-ui/code-editor/markdown-editor/i18n; 3784e81bb7 — seam/scroll-follow/error-boundary/desktop-host. After the launching agent's order, measurements stopped. The official before is the kit baseline in the [[3c13cbc1|overall test measurement]]; the official after and the "keep only measurably useful" decision belong to its quiet window. Numbers above and below are only finished diagnostic samples, not the delivery comparison. Before/after for the other nine packages not taken in this work.

| Package | Run | Wall, s (Vitest) | Tests, s | Import, s | Environment, s | Transform, s |
|---|---|---:|---:|---:|---:|---:|
| query | Original A1 | 21.75 (18.45) | 4.17 | 12.22 | 15.39 | 9.49 |
| query | B cold | 7.21 (4.80) | 2.75 | 2.41 | 16.70 | 2.12 |
| query | B warm, right after cold | 2.87 (2.39) | 2.99 | 0.537 | 3.80 | 0.208 |

query: 10 files, 127 tests, both B green; no files with module mocks/global stubs found. Three shuffle seeds and an isolated run for query not yet launched.

Isolated-file share by current includes: layer 3/29 (10.34%), query 0/10, primitives 2/13 (15.38%), chat-ui 8/44 (18.18%), code-editor 0/3, markdown-editor 0/3, i18n 0/3, seam 2/2 (100%), scroll-follow 0/2, error-boundary 0/1, desktop-host 2/3 (66.67%, denominator includes one itest). These are on-disk file counts, not a claim that every set already passed.

Isolated files of the other packages (paths relative to the package):
- primitives: src/float.test.ts — vi.stubGlobal ResizeObserver and Element.prototype.getBoundingClientRect; src/OverlayLayers.test.ts — Element.prototype.getBoundingClientRect stubbed.
- chat-ui: src/ChatSurface.escape.svelte.test.ts, src/ChatSurface.stalled.svelte.test.ts — vi.stubGlobal ResizeObserver and document.execCommand; src/ChatSurface.still.svelte.test.ts, src/FeedRegions.svelte.test.ts — same stubs plus HTMLElement size prototypes; src/Composer.svelte.test.ts — vi.stubGlobal ResizeObserver and document.execCommand; src/PinnedRegion.svelte.test.ts — ResizeObserver and HTMLElement.prototype.clientHeight; src/TranscriptViewport.svelte.test.ts — conditional globalThis.CSS write; src/entries/ToolDiff.svelte.test.ts — HTMLElement.prototype.offsetHeight.
- seam: src/Seam.svelte.test.ts — window.innerWidth/innerHeight and animation frames; src/SeamHandle.svelte.test.ts — vi.stubGlobal animation frames. In this package both test files stay isolated; only fsModuleCache may help, still to be measured.
- desktop-host: src/ExternalLinks.test.ts and src/QuickHideShortcut.test.ts — vi.mock electron. WindowPlacement.itest.ts stays in the shared selection, as before the change: the package test already included the integration file.
- code-editor, markdown-editor, i18n, scroll-follow, error-boundary: no isolated files; no module/browser-global stubs found in their test files.

In all eleven configurations maxWorkers: 2, persistent cache in git-ignored node_modules/.vitest-module-cache, optimizer off. In packages without isolated files isolate:false stands at the root without a second empty project. In packages with a split, test selects unit*. testbed setupFiles/globalSetup left unchanged; the chat-ui benchmark command and its separate config untouched. i18n/typecheck moved from direct svelte-check to the shared runlith-typecheck per repository rule.

Pre-delivery checks after measurements stopped: two changed layer fixture files each passed with --sequence.shuffle --sequence.seed=1625317968 --maxWorkers=1 --no-file-parallelism: chunk-conditions 7/7, flagged-feature 9/9. Vitest has no --parallel=1, so its one-worker and disabled file-parallelism parameters used. One sequential bun run typecheck across all 11 packages exited 0; layer: 12 existing warnings, query: 9, 0 errors. Full checks of the other 10 configurations on three seeds and with isolation await the quiet window; green typechecks do not replace them.

An independent review by openai-oauth/gpt-6.1-sol xhigh found a leftover fixture DOM in primitives/src/focus.test.ts and chat-ui/src/TranscriptVirtualizer.svelte.test.ts. Confirmed via the node creators and the TranscriptVirtualizer.dispose chain: the virtualizer frees its state, the DOM belongs to the caller. Both fixture files now clear document.body in afterEach; assertions kept, global isolation not restored. Each file individually green with seed 42, maxWorkers=1 and no-file-parallelism: focus 6/6, TranscriptVirtualizer 40/40. No other findings; no repeat review launched. The shared typecheck pass preceded these two minimal teardown edits; their compilation verified by targeted Vitest runs.

Exact commands for the official after, each from the checkout root; package test keeps the original full selection, for chat-ui also the benchmark part. Before cold, only packages/<name>/node_modules/.vitest-module-cache removed with the delete tool; then the same two commands run back-to-back for cold/warm. maxWorkers stays 2.

| Package | Cold and warm measurement command |
|---|---|
| layer | /usr/bin/time -p bun run --cwd packages/layer test |
| query | /usr/bin/time -p bun run --cwd packages/query test |
| primitives | /usr/bin/time -p bun run --cwd packages/primitives test |
| chat-ui | /usr/bin/time -p bun run --cwd packages/chat-ui test |
| code-editor | /usr/bin/time -p bun run --cwd packages/code-editor test |
| markdown-editor | /usr/bin/time -p bun run --cwd packages/markdown-editor test |
| i18n | /usr/bin/time -p bun run --cwd packages/i18n test |
| seam | /usr/bin/time -p bun run --cwd packages/seam test |
| scroll-follow | /usr/bin/time -p bun run --cwd packages/scroll-follow test |
| error-boundary | /usr/bin/time -p bun run --cwd packages/error-boundary test |
| desktop-host | /usr/bin/time -p bun run --cwd packages/desktop-host test |

For the full correctness check in the quiet window, the commands below run the unit set through testbed directly: arguments to bun run test would otherwise land on the last benchmark command for chat-ui. In each line first the suffix --sequence.shuffle --sequence.seed=42, then the same suffix with 1729 and 8675309, then a separate --isolate; four launches per line, not one launch of all packages at once.

| Package | Correctness base command |
|---|---|
| layer | bun run --cwd packages/layer testbed vitest run --project 'unit*' |
| query | bun run --cwd packages/query testbed vitest run |
| primitives | bun run --cwd packages/primitives testbed vitest run --project 'unit*' |
| chat-ui | bun run --cwd packages/chat-ui testbed vitest run src --project 'unit*' |
| code-editor | bun run --cwd packages/code-editor testbed vitest run src |
| markdown-editor | bun run --cwd packages/markdown-editor testbed vitest run src |
| i18n | bun run --cwd packages/i18n testbed vitest run |
| seam | bun run --cwd packages/seam testbed vitest run src --project 'unit*' |
| scroll-follow | bun run --cwd packages/scroll-follow testbed vitest run src |
| error-boundary | bun run --cwd packages/error-boundary testbed vitest run |
| desktop-host | bun run --cwd packages/desktop-host testbed vitest run src --project 'unit*' |
