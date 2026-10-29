---
id: 01a17a74-ae9e-7031-af45-864eafadc5fd
title: testbed records a file's own world on the worker's previous file and kills its processes as another file's leftover
ord: 49
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17a74-e816-791a-bb1b-0340124dbba7",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a17a50-d68c-7585-86b0-7c1a782481cd
sources:
  - kind: file
    ref: packages/testbed/src/bun.ts
---
With `--no-isolate`, a file's own world built in its describe's `beforeAll` can record onto the worker's previous file. Then the previous file's `bed.leave` sees that world's processes as its leftover, kills them (8 s guard), and the previous file fails while itself clean.

Evidence — the threads-tests run `/tmp/runlith-test/reports/run.79249.1793055107349.jsonl`, worker 79278:
- `library.itest.ts` (seq 134): `residue: 2`, guard 8092 ms wall, fail verdict. All 16 tests pass.
- The `world` row for `testing/DoorFixture`, `own: "it signs accounts in"`, built, 987 ms CPU / 2089 ms wall, recorded on `library.itest.ts`. That `own` is declared only by the next file `accountSelection.itest.ts` (seq 135); its `load` — the same 988/2091 ms.
- `shelf.itest.ts` with the same registration (`layer(...)` from `@runlith/effect-test`, only `expect` from `bun:test`) records correctly: its own world on `shelf` itself.
- The `accountSelection` → `library` pair separately: 21 pass, no leftover (`run.48073.1793055766733.jsonl`).

The root proved with a synthetic pair through the public testbed CLI on Bun 1.4.4: `Bun.main` already names the second file at registration, but `createRequire('bun:test').beforeAll !== beforeAll` from ESM. `world(..., { own })` sets its early hook through `require`; the ESM intercept `mock.module` never sees it. So the build starts before `handoff`, which only the next ESM `layer()` call sets; accounting and the watcher still belong to the first file at build time. Before the fix, both synthetic-pair bodies passed, the world recorded on the first file, and the watcher killed the process in 8 s; the verification run's report — `/tmp/runlith-test/reports/run.75979.1793056042766.jsonl`. A direct `own()` build in the `layer()` hook itself already passed on that pair: the evidence was about the early `world()` hook before describe, not the late `Bun.main` update.

Fixed in `3f9ca42c87`: preload sets the same intercepted registrations in ESM and require. Regression through the public CLI green; testbed typecheck plus 37 itest + 10 unit on seeds 1, 2, 3 passed. An exact replay of all 147 worker-79278 files kept the order: `sameSequence: true`, all residue = 0; `library` — 16/16 pass, guard 2.3 ms, its own DoorFixture on `accountSelection` (5/5 pass). Run: 911 pass / 1 foreign fail in `conversations.itest.ts:269`, expected `{ complete: true, unindexed: 0 }`, received `{ complete: false, unindexed: 1 }`; run address `c52e142b-3d17-40fe-9b10-35233f35b2be:167`. The red evidence stays in run `3255800b-fce1-4014-aaa7-e6efd5b1eb16:167`; the temporary JSONL already rotated away. An independent static review found no findings. A separate daemon/a-loads failure at alive = false turned out to be Bun `--no-orphans` inheritance by child programs, fixed in `27cdc1623a`. The final `check:change --package packages/testbed` passed: 9 files, 0 from cache, 19.90 s wall / 15.27 s CPU; the first delivery's verifications thereby done.
