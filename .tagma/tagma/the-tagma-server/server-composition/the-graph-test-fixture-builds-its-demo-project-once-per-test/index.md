---
id: 01a0d556-c247-7d1e-b72c-3ae909744317
title: The graph test fixture builds its demo project once per test file and gives each test a copy of that state over the production store
ord: 29
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/graphFixture.ts
  - kind: symbol
    ref: apps/tagma/server/src/platform/contract/service/store.ts
    symbol: Store
---
The server's graph tests stop paying for a whole new graph on every test. `graphFixture` builds its demo project once per test file and hands each test a copy of that file's state, reached through the same store implementation production uses. This is the cost half of the test layers decision: those tests are integration and stay integration, but they get cheap.

## 1. Observable outcome

- Opening the graph fixture costs at most 40 ms per test after the first in its file, measured on an idle machine, down from about 120 ms idle and 230 ms under load.
- Each test still starts from the same state: no row, directory or in-memory value written by one test is seen by the next.
- No test changes its body. The fixture keeps its surface (`open`, `release`, `DemoGraph`).

## 2. Problem, with evidence

Measured on 2026-09-24:
- **83 of the server's test files build the fixture; 58 of them in `beforeEach`.** In a full run, 1169 tests of 100 ms or more take 548 of 572 s. The graph tests' floor sits in that band: `mcp/McpServers.test.ts` runs 23 tests at a minimum of 93 ms and a median of 146 ms.
- **One `open()`** (20 rounds, `bun` 1.4.2, a load of other sessions present): median 231 ms, the first 1 s, release 11 ms. Split idle:
  - `Store.seeded()` — copying the seed database and starting its `sqlite-process` child: about 26 ms;
  - the graph services' layer on top: about 40 ms;
  - `projects.add` of the demo project: about 56 ms.

## 3. What holds now

- `graphFixture().open()` (`graph/core/graphFixture.ts`) makes a fresh `demo-<uuid>` directory in a `FixtureScope`. It builds a `ManagedRuntime` over `graphLayer`, `unitsLayer` and `Store.seeded()`, then registers a project named `demo` at that directory.
- `Store.seeded()` copies the migrated seed database (`db/Store.ts#seedDatabase`, built once per process) into a temp file and opens it through the `sqlite-process` child ([[96b75e80]]).
- `projects.add` resolves the root's filesystem identity ([[b77b7a93]]) and installs the vocabulary. A project row is therefore bound to its directory's identity, not only its path.

## 4. Target model

### Per file, once

The first `open()` in a file builds the demo state as today, at a demo root fixed for the file. It then snapshots it:
- the store's database, through SQLite's own backup into a template file in the fixture root;
- nothing else, because all graph state lives in the store — step 1 of the build verifies that claim (see 9).

### Per test

- Copy the template database into a fresh file, then start the store over it: the same `Store` layer and `sqlite-process` child production uses.
- Empty the demo root in place, keeping the directory and its identity, so the registered project still names it.
- Build the graph services over the new store. The services' own ~40 ms is measured per service in step 1, and any startup read found there is made lazy at its owner, not skipped in the fixture.

What a test sees is the same demo project, empty, as today. It pays one file copy, one child start and the services.

### Kept out

- **No shared runtime or store across tests.** In-memory state in services — caches, settings, subscriptions — would leak between tests.
- **No second store implementation.** An in-process store without the child is a second implementation of one contract, and it must agree with the first in everything. That is a larger question than this cost and is not taken here.

## 5. Owners and boundaries

- `graph/core/graphFixture.ts`, under [[5940edc1]], owns the template and the per-test copy.
- `db/Store.ts` gains a door that opens a store over a given database copy. `Store.seeded()` stays as is.
- Service owners: any startup cost found in step 1 is fixed at its owner.
- The test layers decision (sibling) moves the fixture's users to `*.itest.ts`. This decision does not depend on it.

## 6. Rejected alternatives

- **A transaction per test, rolled back.** Production code opens its own transactions through the child's writer, and nesting them under a test's would change what the code under test does.
- **An in-memory store** (see 4).
- **One runtime per file, reset per test.** It depends on every service's in-memory state being resettable, which nothing checks.

## 7. Acceptance criteria

- A test that writes a block, a setting and a file under the demo root, followed by a test in the same file, sees none of them.
- The median `open()` after the first in a file is at most 40 ms on an idle machine. The figure is measured by the fixture's own benchmark and named in the close.
- The fixture's own tests and the 83 users pass unchanged.
- A full server run's summed test time drops. Before and after are named in the close.

## 8. Claims and tasks this touches

- Claims over `graph/core/graphFixture.ts` and `db/Store.ts` are revised where their sources change. The fixture's release claims survive: one release per open, the root removed.
- Any claim over a service whose startup read becomes lazy is revised at that owner.

## 9. Order of building

1. Measure: the per-service construction cost, and whether any graph state lives outside the store, such as files under the demo root that services write at registration.
2. The template and the per-test copy.
3. Lazy startup at the owners the measurement names.

## 10. Contract

- Internal to the server's tests. `DemoGraph` and `GraphFixture` keep their shape.

## 11. Stored data

- The template lives in the fixture root and is removed with it.

## 12. Who may do what

- out: tests only; no operation or permission changes.

## 13. Long-lived things

- The template lives from the first `open()` to the file's last `release()`. A file whose first `open()` fails builds none, and the next `open()` retries.

## 14. Bounded resources

- One template per test file, the size of the seeded database with one project.

## 15. Rollout

- The fixture changes in one commit. Its users do not change.

## 16. Failures

- A backup that fails fails the first `open()`, with the cause, as a build failure does today (`DemoGraphUnbuilt`).
- A worker killed mid-file leaves its fixture root to the residue sweep ([[b335365b]]).

## 17. Observability

- The fixture's benchmark prints `open()` percentiles.
- The runner's processor-time budget for integration files shows the drop.
