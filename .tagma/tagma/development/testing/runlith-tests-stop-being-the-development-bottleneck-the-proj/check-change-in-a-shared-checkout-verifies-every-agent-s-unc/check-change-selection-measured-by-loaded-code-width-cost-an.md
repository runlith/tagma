---
id: 01a17bc1-87d4-70f9-b74a-c594ed1e95f9
title: "check:change selection measured by loaded code: width, cost, and red tests"
ord: 1
---
One sample: Apple M2 Max, 2026-10-27 around 06:00, load 2.3–3.7, shared checkout with other sessions' edits in flight. "Before" is `check.ts` from HEAD `534c928`; "after" is this work's working tree. Selection is computed with `--plan --paths-from`.

**Selection, files (before → after).**

| Sample | Before | After, before first trace | After |
|---|---|---|---|
| edit of the `change-record/holdings/requests.test.ts` test | 561 (560 by cards) | 5 | 1 |
| `composition/testing/speech/world.ts` and its five tests | 508 (497 by cards) | 15 | 11 |
| `packages/highlight/src/colours.ts` leaf package | 95 (73 by cards) | 27 | 23 |
| `change-record/holdings/heads.ts` | 655 (136 by cards) | 522 | 519 |
| `speech/credentials.ts` (server module under runtime) | — | — | 142 |

Over nine hundred card-selected files did not come from computed `import()`s: 1453 of 1513 "unresolved" sites were `@runlith/effect-test`, whose `exports` lack the `browser` condition, so the graph treated an import unresolved under at least one condition set as unresolvable. There are five computed `import()`s that tests reach. Four are reached by one test each, and one trace closes them. The fifth (`packages/tagma/src/adapter/loader.ts`) is reached by 532 tests; it is declared in the package's `changeCheck.loads`.

The load-based selection floor is the runtime world: a module statically included in `composition/runtime.ts` is loaded by about 141 tests, so editing such a module selects no fewer. `heads.ts` is loaded by 519 tests, 238 of them only through static imports, the rest through lazy `import()`s. Lazy edges are not narrowed by the write ([[504fa5da]]).

**Cost, adjacent runs with `--no-cache`, `colours.ts` sample.** Old — 95 files: wall 11.2 and 10.4 s, CPU (user+sys of the whole command) 42.7 and 41.8 s. New — 23 files: wall 4.7 and 4.6 s, CPU 21.8 and 21.8 s. Test edit — 1 file, wall 0.96 s; `speech/world.ts` — 11 files, wall 2.2 s, CPU 8.7 s. The old run selected 561 and 508 files on those two samples; three such runs on 2026-10-27 hit the 10-minute command life limit ([[55b6930a]]) and were not repeated here. Repeat with no changes: 0 run, 23 from cache, wall 0.73 s.

**Red tests.** For 11 "commit → test it turned red" pairs from main history over 2026-10-26/27 (8 certain, 3 presumed), the plan over the commit's paths without the test itself selects the test in 10 cases. The eleventh commit (`03cdb7f`) changed nothing but that test and one other test file, and the test is selected as changed. The [[2809e291]] commits are not in the current history: main starts at root `4736d66` from 10-26.
