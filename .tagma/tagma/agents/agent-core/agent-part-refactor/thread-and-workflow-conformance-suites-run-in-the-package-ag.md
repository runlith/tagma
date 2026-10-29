---
id: 01a118eb-3e7e-7085-8f2e-2ccb523c3230
title: Thread and workflow conformance suites run in the package against InMemory and in Tagma against SQLite
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: packages/agent/src/thread/conformance
---
Goal: every thread- and workflow-store contract is proven in seconds inside the package itself, against `InMemory*` adapters, by the same suites Tagma runs against SQLite. Every next rework step gets a fast signal, and the in-memory adapters stop answering to no contract. The `workflow/memory.test.ts` shape is already the right model. Three suites are scenario dumps never cut by subject: `runLog.ts` (4592 lines without imports), `storagePort.ts` (1496), `compactionRequests.ts` (975).

## Now

Eleven `thread/conformance/*` suites run only in Tagma against SQLite. The package never imports them, and the `InMemory*` adapters serve unit tests subject to no contract. The correct shape already exists — `workflow/memory.test.ts`. Three suites are scenario dumps never cut by subject: `runLog.ts` (4592 lines without imports), `storagePort.ts` (1496), `compactionRequests.ts` (975).

## What gets built

- In the package, one runner per suite over the `InMemory*` factory, modeled on `workflow/memory.test.ts`. A suite's test layer follows [[ad3c527d]] and [[adb6798b]]: a suite needing disk or a process stays in Tagma.
- `runLog.ts` is cut by subject — runs, stops, processes, answers, prompts — with a shared `scriptedRun` world.
- `storagePort.ts` is cut into one suite per port: runs, transcript, event log, spawn, owner settings.
- `compactionRequests.ts` splits into compaction requests and `compactionParent`; the latter belongs to collaboration.
- Every `InMemory`/SQLite divergence the runners expose is decided as a contract decision: either the violating adapter is fixed or the contract is fixed where it described one adapter's accident. A divergence is never skipped or marked skip ([[93739392]]).
- Every existing test is judged by the contract it protects ([[4f387de2]]). Port-adapter binding checks (`ThreadPorts.test.ts`) and failure-cause preservation (`ThreadBorder.test.ts`) stay while their boundary stands, or are replaced by an equivalent test of the new owner. Prose string checks in `CollaborationTools.test.ts` are deleted. The shipped-workflow check (`workflow/shipped.test.ts`, reads disk in the unit layer) moves to its owner in the right layer unless its contract is covered more cheaply.

## Acceptance criteria

- Every storage/runtime conformance contract runs on both applicable adapters. Helpers and scenarios with a mandatory external resource do not count as missing runners.
- No conformance file exceeds 650 lines without imports. The debt records for `runLog.ts`, `storagePort.ts`, and `compactionRequests.ts` disappear.
- Observable behavior is preserved. A changed contract names its reason and gets the same new assertions on both adapters.
- The package's unit runner files fit their layer budget.
