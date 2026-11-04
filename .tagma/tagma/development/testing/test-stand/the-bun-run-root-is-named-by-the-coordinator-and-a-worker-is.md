---
id: 01a16b72-6ce5-75e9-ae72-5c3eced00efd
title: The Bun run root is named by the coordinator, and a worker is known by `--test-worker` in the real argv, not BUN_TEST_WORKER_ID
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/testbed/src/bun.ts
  - kind: file
    ref: packages/testbed/src/core/run.ts
---
The Bun run root is named by the coordinator, and a worker is recognized by `--test-worker` in the real argv, not by BUN_TEST_WORKER_ID. `BUN_TEST_WORKER_ID` is inherited by any nested `bun test` a test starts from a worker; if the variable marked a worker, the nested run would take the outer root, find it already created and skip the sweep — survivors of past runs would stay alive.

The run base reaches nested processes through `RUNLITH_TEST_BASE`, separately from `TMPDIR`: confinement changes the temporary directory, but a nested run must still sweep the same dead run roots. Under the `testbed` CLI the root and report file reach the runner through `RUNLITH_TEST_RUN_ROOT` and `RUNLITH_TEST_REPORT`. The file environment loses these two variables, so a nested run started by a test gets its own root and report file and never appends to another's — unless the test itself names it a report file. The CLI only appends its own lines to the report — outcomes, workers, run — and never rewrites a file others may be writing into.
