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
