---
id: 01a11784-13f7-785e-9c6c-9a1d6354591c
title: The full test run goes in GitHub Actions on one macOS-runner workflow
ord: 13
tags: ["task"]
fields:
  {
    "holder": "tagma:01a10b6b-4914-700e-9ebb-e850cf14b11c",
    "status": "done"
  }
---
The operator wants the full test set (unit, integration, system of every package) run in GitHub instead of their machine.

What to do:
- each package declares its layers with `test`, `test:integration`, `test:system` scripts — some `*.itest.ts`/`*.stest.ts` (inspection, ndjson-rpc, speech, utils, execution-host, tsconfig) are started by no script now;
- `.github/workflows/test.yml`: manual start and push to main, jobs by layer, server integration split by `bun test --shard`.

The runner is macOS: the execution host builds `libexecution_pty.dylib`, and server integration does not go without it.

Done when the workflow lies in the repository and a trial run on GitHub showed a result (push is the operator's word).
