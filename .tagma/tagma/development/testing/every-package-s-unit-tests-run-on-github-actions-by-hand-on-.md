---
id: 01a1a10d-9f4e-7cc0-807d-9725457121f9
title: Every package's unit tests run on GitHub Actions by hand, on Linux
ord: 19
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19eb2-4a56-79d0-9dbd-af67ec98a662",
    "status": "in_work"
  }
sources:
  - kind: file
    ref: .github/workflows/unit.yml
---
The second check of the CI rebuilt one check at a time ([[2c1388d8]] was the first): every package's unit tests, the `*.test.ts` kind, on `ubuntu-latest`, started by hand. The workflow runs `bun run test:all --script test`, which prints wall and CPU per suite, and uploads the run report and the testbed reports as the `unit-report` artifact.

A package's `test` script used to also carry its native tests: `cargo test` in execution-host, `swift test` in audio-darwin. They now stand in their own `test:native` script, so `test` runs only `*.test.ts` and can run on Linux, while the native tests go to a macOS job. `test:all` runs `test:native` suites beside `test` and `test:integration`.

Done when the workflow is on main and one run's per-suite times are recorded here.

## First runs, 2026-11-03

Run [41624932506](https://github.com/runlith/tagma/actions/runs/41624932506), `ubuntu-latest`: 64 suites, 1258 files, 8416 tests; `test:all` 128.8 s wall, 322.6 s CPU under a testbed budget of 2 processes; the job 3 min 3 s including 48 s of setup. The app's Vitest suite takes 77.3 s wall and 199.1 s CPU, the combined Vitest packages 25.2 s and 63.4 s, everything else under 8 s per suite.

The earlier run [41623545687](https://github.com/runlith/tagma/actions/runs/41623545687) failed in most suites because Bun refuses any read of `test.only` when `CI` is set and `@runlith/effect-test` read it at load (fixed in `a8884fc7bd`); `checks/law`'s `test` also ran its itests (`b5b23c9f30`), and the no-focus-steal runtime ignored the host's platform (`21ed893ba8`).

Red in the second run:
- red on HEAD locally too: `apps/tagma/server/src/composition/handles.test.ts` (`read_block.reads[].refsOutDetails[].name` is not printed), `composition/places.test.ts` (`submit_work.derive[].paths` declares no place role), `packages/agent/src/thread/conformance/runLog/admission.test.ts` (two keyed-admission cases), `packages/builtin-catalog/src/core/catalog.test.ts` (Muse rows label the contributor models without the Muse prefix that `opencode-go` keeps);
- red only on a fresh Linux checkout: `checks/law/environment.test.ts` (the unit test reaches the SQLite engine build, which writes), `packages/execution-host/src/Interpretation.test.ts` (a heap census still finds one released row), `packages/chat-ui/src/transcriptDelta.bench.ts` (a wall-time ratio of 2.82 against a budget of 2).
