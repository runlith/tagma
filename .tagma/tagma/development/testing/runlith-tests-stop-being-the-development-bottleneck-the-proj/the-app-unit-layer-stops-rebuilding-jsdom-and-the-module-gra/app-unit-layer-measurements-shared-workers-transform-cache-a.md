---
id: 01a16b39-b6f3-729c-acaa-b4765bb2a136
title: "App unit-layer measurements: shared workers, transform cache and optimizer"
ord: 2
---
Measurements of 2026-10-24 on Apple M2 Max (12 cores, 32 GiB), macOS 26.0.1; Bun 1.4.3 (`bun --version`) and Vitest 4.1.11, maxWorkers: 2. Each result is one sample on a shared machine. Before splitting, the command in apps/tagma/app is `bun run --bun vitest run --project unit`; after, `bun run --bun vitest run --project 'unit*'` so both projects still cover all 229 files and 1445 tests. `bun run test` selects both projects; `--project unit` after the split selects only 214 shared files (1327 tests), 15 more files (118 tests) remain in `unit-isolated`. Every line below is the full selection.

| Configuration | Cache | Wall, s (Vitest) | Bodies, s | Import, s | Environment, s | Transform, s |
|---|---|---:|---:|---:|---:|---:|
| Baseline, default isolate | First run, fsModuleCache off | 156.83 | 38.29 | 170.76 | 73.90 | 65.10 |
| Baseline, default isolate | Repeat run, fsModuleCache off | 181.35 | 46.80 | 199.55 | 82.02 | 143.65 |
| isolate: false, 15 files unit-isolated, fsModuleCache and optimizer off | No persistent cache | 59.81 | 30.31 | 62.52 | 53.70 | 109.99 |
| fsModuleCache only on top of isolate: false | Cold | 86.11 | 40.87 | 95.19 | 87.08 | 75.49 |
| fsModuleCache only on top of isolate: false | Warm | 66.75 | 38.16 | 59.55 | 77.10 | 17.16 |
| SSR optimizer only (TanStack), fsModuleCache off | First full run, dependency cache after narrow probes | 93.23 | 39.24 | 106.91 | 70.80 | 188.20 |
| SSR optimizer only (TanStack), fsModuleCache off | Repeat run | 86.43 | 35.95 | 101.56 | 76.24 | 193.31 |
| fsModuleCache + SSR optimizer | Both caches cleared before launch | 105.26 | 45.49 | 126.42 | 95.56 | 250.47 |
| fsModuleCache + SSR optimizer | Warm | 73.81 | 39.69 | 67.73 | 80.69 | 18.51 |
| Control A: isolate: false, fsModuleCache and optimizer off | Before final B, after StatusBar fixture fix | 80.53 | 35.27 | 88.90 | 74.58 | 159.44 |
| Delivery B: isolate: false + fsModuleCache, optimizer off | Cold transform cache | 74.36 | 36.99 | 78.29 | 65.10 | 58.14 |
| Delivery B: isolate: false + fsModuleCache, optimizer off | Warm transform cache | 43.89 | 29.30 | 35.19 | 48.58 | 7.21 |
| Last adjacent pair, final fixtures: isolate: false, cache off in config | No persistent cache | 48.13 | 24.98 | 50.00 | 39.44 | 67.23 |
| Last adjacent pair, final fixtures: isolate: false + fsModuleCache | Original config bytes restored, previous cache warm | 36.46 | 23.68 | 27.91 | 38.75 | 4.60 |

Baseline taken before the app change. First run: exit 0, 229 files and 1445 tests passed. During it machine busy 64.0%; agents, the Tagma server and GUI worked alongside. The second run also had baseline SQLite and a build without a server restart. During the intermediate comparisons machine busy was 47–48%, before the final cold/warm comparison 28.7–31.9%; load varied, so wall across series cannot be attributed to configuration alone. During the last adjacent pair, Claude conformance and sqlite-process checks ran alongside. The per-line CPU breakdown from read_machine_load is incorrect (reflection [[d87d020b]]), so only the returned machine busy and the description of parallel work are used here.

The four columns are exactly Vitest's output, not CPU and not non-overlapping wall intervals. At `maxWorkers: 2` the environment counter is inflated for a shared worker: `base.B6Opl8PE.js#runBaseTests` re-records the saved `_environmentTime` on every task; `index.DXx9Tk7.js` carries it into `file.environmentLoad`; `groupSpecs` in `cli-api.CnMVyzaz.js` merges files of one environment into a task only with one worker. So the environment sum reflects repeated counting of the first environment. The spec criterion — warm import + environment + transform no more than bodies by these printed numbers — is not met: in the last pair 71.26 s vs 23.68 s. Even without environment, import + transform = 32.51 s, so the question does not reduce to the counter. True wall and transform reduction shown separately.

Delivery keeps `isolate: false` and `experimental.fsModuleCache: true`, optimizer off: the last adjacent pair of the full set gave 48.13 → 36.46 s with close bodies 24.98 → 23.68 s; transform 67.23 → 4.60 s. For the no-cache variant the boolean in the config itself was changed, then the same bytes restored without clearing the cache. With Vitest 4.1.11 the CLI `--experimental.fsModuleCache=false` changes only the root: in the probe through createVitest the root was false while both extended projects were true, so that probe does not count as a no-cache variant. The CLI `--isolate` verified the same way: it enables isolation for both projects.

`deps.optimizer` not in delivery. The SSR variant with `@tanstack/query-core` and `@tanstack/virtual-core` passed 229/1445 but showed no speedup. The client variant with Effect and TanStack first gave 35 failures in eight files; after removing Effect, four CodeMirror failures remained: `Unrecognized extension value in extension set ... multiple instances of @codemirror/state`. Vite adds `?v=...` to imports from node_modules that are not bundled into the dependency bundle, while CodeMirror's own native imports go without that query: `EditorState` gets two identities. Full inlining of the CodeMirror family returns a green narrow run but grows transform; the disabled client optimizer avoids that cost. The negative result kept in the measurement instead of enabling a more expensive configuration.

In `unit-isolated`: 15/229 files (6.55%) and 118/1445 tests (8.17%). Paths below relative to `apps/tagma/app/src/lib`; the other 214 files use `isolate: false`.
- `app/chrome/projectSwitch.svelte.test.ts` — animation frames stubbed.
- `app/graphScope.svelte.test.ts` — fetch stubbed.
- `features/checkout/DiffStage.svelte.test.ts` — ResizeObserver stubbed.
- `features/executions/terminal/Divider.svelte.test.ts` — animation frames stubbed.
- `features/executions/terminal/Pane.svelte.test.ts` — observers, frames and navigator stubbed.
- `features/executions/terminal/PaneTree.close.svelte.test.ts` — ResizeObserver and frames stubbed.
- `features/executions/terminal/Views.svelte.test.ts` — observers, frames and navigator stubbed.
- `features/graph/ProjectTree.svelte.test.ts` — fetch stubbed.
- `features/notices/refusalNotice.svelte.test.ts` — fetch stubbed.
- `features/speech/viewSpeech.test.ts` — AudioContext, page, WebSocket, fetch and navigator stubbed.
- `features/threads/Column.svelte.test.ts` — ResizeObserver and CSS stubbed, document.fonts changed.
- `features/threads/ColumnWindow.svelte.test.ts` — ResizeObserver stubbed.
- `features/threads/ThreadSlot.open.svelte.test.ts` — animation frames stubbed.
- `features/worktrees/Window.svelte.test.ts` — IntersectionObserver stubbed.
- `wire/liveResume.test.ts` — liveGroup module mock.

Shuffling found three order dependencies in fixtures. StatusBar clears its shared double's health and quietSince before every test. liveReopen creates the LiveConnection in each test's scope via effect-test; the connection no longer lives between tests and makes no real WebSocket call. Pane waits for the initial subscription before remount: without it, a cold lazy engine is not yet open and remount legitimately does nothing. Assertions kept. Pane fix: commit `5899c09cf49eb42b1fd7bd3b5e50781c40e0cc5`.

Final code checks: three full runs with `--sequence.shuffle --sequence.seed=42`, `1729`, `8675309` — each 229/1445, exit 0. Full `--isolate`: 229/1445, exit 0, 166.12 s (tests 52.06, import 155.26, environment 90.46, transform 21.60). `bun run typecheck`: exit 0, 0 errors; existing a11y warning in CastView.svelte.
