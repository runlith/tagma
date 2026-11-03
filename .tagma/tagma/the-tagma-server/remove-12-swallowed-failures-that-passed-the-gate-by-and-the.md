---
id: 01a15120-d709-7d8e-800b-35675ea9ebea
title: Remove 12 swallowed failures that passed the gate by, and the empty catch in inspection calibration
ord: 139
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15121-448e-7bfa-9c6e-74659c05d4d2",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a0ea9b-7911-79ce-8e1b-ad81ea465bed
sources:
  - kind: file
    ref: apps/tagma/inspection/src/core/node/run.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/workers/calibration.ts
  - kind: file
    ref: apps/tagma/server/src/cut/release.ts
  - kind: file
    ref: apps/tagma/server/src/installation/process/succession.ts
  - kind: file
    ref: apps/tagma/server/src/installation/registry/export.ts
  - kind: file
    ref: apps/tagma/server/src/sandbox/guests/release.ts
  - kind: file
    ref: apps/tagma/server/src/threads/journal/rolloutReconciling.ts
  - kind: file
    ref: apps/tagma/server/src/workspace/repositories/registry.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadRunContexts.ts
  - kind: file
    ref: packages/executions/src/WireSession.ts
  - kind: file
    ref: packages/mcp/src/McpSession.ts
  - kind: file
    ref: packages/mcp/src/sdk.ts
  - kind: file
    ref: packages/performance/src/CpuProfiler.ts
  - kind: file
    ref: packages/sqlite-process/src/writerPermit.ts
---
Twelve places turn a failure into success and stand in the code past the gate [[ea465bed]] (the escaped list in `read_enforcement(rule="ea465bed")`), plus an empty `catch {}` in inspection calibration. Each place is resolved on its own condition: the failure is handled by tag, becomes a typed refusal, or is declared a best-effort resolution with a reason — a resolution only where the failure truly does not change the answer.

Places:
- `packages/sqlite-process/src/writerPermit.ts:42` — `writerPermit.transaction`, `ignore` — first: the SQLite writer transaction;
- `packages/agent/src/thread/run/ThreadRunContexts.ts:99` — `makeThreadRunContexts.reconcile`, `ignore`;
- `packages/executions/src/WireSession.ts:402` — `run.unsubscribe`, `ignore`;
- `packages/mcp/src/sdk.ts:577` and `:585` — `mcpClose.terminate`, `mcpClose`, `ignore`;
- `packages/performance/src/CpuProfiler.ts:88` — `make.session`, `ignore`;
- `apps/tagma/server/src/threads/journal/rolloutReconciling.ts:39` — `rolloutReconciling.settle`, `catch`;
- `apps/tagma/server/src/workspace/repositories/registry.ts:317` — `makeRepositoryRegistry.holds`, `catch`;
- `apps/tagma/server/src/installation/cut/release.ts:253` — `releaseWith`, `ignore`;
- `apps/tagma/server/src/installation/process/succession.ts:279` — `processSuccession.started`, `ignore`;
- `apps/tagma/server/src/installation/registry/export.ts:19` — `registryExportLayer.dump`, `ignore`;
- `apps/tagma/server/src/sandbox/guests/release.ts:54` — `dropPartial`, `ignore`;
- `apps/tagma/server/src/enforcement/workers/calibration.ts:113` — empty `catch {}` around `facetOf` in the trial run.

Outcome on commit `5d0ff432b03006fa1494d8c826f64d086881044d`: after a full re-measurement, escaped — 0, debt — 0. Ten best-effort places carry exact whys; rollout handles `ThreadProjectionRefused`, registry handles `NotFound`, `BadResource`, and typed `RepositoryUnavailable`. Server and CLI calibration skips only `UnsupportedSource`: the real court decides unsupported or a damaged base, other probe failures are not hidden. 56 tests in nine files passed, all applicable gate checks and one independent review; confirmed findings fixed. Registry tests share a layer and fit the budget. The full server `bun run typecheck` did not pass: the last run reported "Found 10 errors in 8 files" in unrelated operations, paging/agent-tools, and `ThreadHosting`/`hostedOrder` of the shared checkout; the delivery's own 17 files gave no errors. The Tagma server was not restarted.
