---
id: 01a0d5ab-d94a-7889-bc00-c5d0e5d3a025
title: "The Tagma server and CLI start child processes asynchronously: no synchronous spawn in shipped code"
ord: 36
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d5ac-08f8-7039-8358-9a564d079528",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0d557-57ac-7933-91ac-35a2cfda2fc7
---
**Why.** bun 1.4.2's `Bun.spawnSync` can spin forever, with its child left as a zombie, when a GC finalizer runs inside the call ([[42c25b2b]]; fix pending upstream as oven-sh/bun PR #40078). `node:child_process`'s sync calls go through the same code. A synchronous spawn also stops the server's whole event loop while it runs. The operator decided on 2026-09-24: product code moves to asynchronous spawns.

**Measured on 2026-09-24,** 60 sequential `git rev-parse` calls: 19.9–20.6 ms each synchronous and 17.0–23.8 ms each asynchronous. The spawn itself dominates, so nothing gets slower.

**Scope.** Every synchronous child-process call in code the Tagma server or its CLI runs:
- `Bun.spawnSync`, and `spawnSync`, `execSync` and `execFileSync` from `node:child_process`;
- in `apps/tagma/server/src` outside tests, and in the runtime packages the server loads.

Known today:
- `http/checkoutBuilds.ts` — two `ps` reads;
- `skill/mcpDeclaration.ts` — waits on a command under `APPROVAL_BUDGET_MS`;
- `install/try.ts`;
- `cli/commands/setup.ts`.

Take the inventory yourself; this list is not proof of completeness. Build scripts under `packages/*/scripts` and test code are out; tests are their own task.

**Owners.** Fix each call at its owner. Where the caller is synchronous, make it asynchronous up the chain rather than wrapping a sync call.

**Done when:**
- no synchronous child-process call remains in the scope, and the close names each place changed;
- the suites of the touched owners pass;
- the claims over the touched code are revised at their owners.

**Outcome (commit aa7b685095).** The inventory found exactly the four known places:
- `http/checkoutBuilds.ts`: `descendantsOf` and `commandOf` read `ps` through `Bun.spawn`; both callers were already async.
- `skill/mcpDeclaration.ts`: `approve` spawns asynchronously under the same `APPROVAL_BUDGET_MS` timeout. A timed-out approval now reads "was ended by SIGTERM" instead of "exited null". `declareInto` and `installMcpDeclarations` are async, and so are `installInto` in `skill/install.ts` and its callers `refreshInstallations` (`Effect.tryPromise`) and `tagma install`. The CLIs are still declared one after another, because two surfaces can share a file.
- `install/try.ts`: `checkoutRoot` and `registerCheckout`.
- `cli/commands/setup.ts`: `tagma install`'s `git rev-parse`.

The synchronous calls left are outside this task's scope:
- the test fixtures `graphFixture`, `doorFixture`, `fixtureHosts`, `sandboxFixture`, `preparedTreeFixture`, `packages/git` `gitFixture` and `packages/execution-host` `hostFixture` (task f89e06b0);
- `performanceBound.bench.ts`;
- `packages/dev-runner`, which the server does not load.