---
id: 01a11681-3d09-70d2-97f5-12dc69a227ce
title: "S1: install startup check, WorkerUnavailable at worker owners, system test of the built release"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a11682-725a-7c16-9960-d1b346ab34cf",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1166f-7113-7752-b6b9-0a721509a7f0
---
Finish [[1509a7f0]] — what did not land in f40590b15b. The work goes in the main checkout.

- **Startup check.** Before serving calls, composition verifies that every module from the `parts` of install.json with the `server` role stands in the install. If a module is missing, startup refuses with the file name. Only presence is checked; workers are not launched.
- **`WorkerUnavailable`.** Every worker owner writes `error`/`close` to the log once with the reason and answers with a typed failure. The consumer never turns it into "unread" or an empty answer.
  - Owners: `packages/git` (unpack), `change-record/lines/walks.ts`, `native-harness/transcript/restedWork.ts`, `platform/durable/flush.ts`, `packages/agent-tools` pdf, `packages/ndjson-rpc`, `packages/activity`, `packages/performance`, `enforcement/workers`.
  - Where a consumer currently swallows the failure, it passes it up as its own answer's failure.
- **System test over the built release.** Every literal `new URL('./…', import.meta.url)` reachable from the server entry point resolves to a file in the release. judge, reach, the telemetry worker, walk, unpack and rested are named explicitly in the test.

**Do not touch:** `packages/bundle` and `installation/cut/**` — that is thread 01a10b6b's area; only reading the manifest is fine.

**Done when:** the acceptance of [[1509a7f0]] passes, typecheck and the tests of the affected packages are green, and the change is landed through `submit_work`.
