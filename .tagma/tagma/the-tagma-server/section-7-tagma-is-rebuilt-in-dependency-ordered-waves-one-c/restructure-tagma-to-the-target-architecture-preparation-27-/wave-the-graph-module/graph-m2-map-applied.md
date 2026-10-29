---
id: 01a0e532-ca7c-7f96-97dd-247ba9fd89de
title: "graph M2: map applied"
ord: 2
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0e470-ffc4-7261-8631-2ffbf7e0b9dd
  - kind: waits-on
    to: 01a0e532-c806-7806-be5d-983121d8b775
  - kind: waits-on
    to: 01a0e532-ca72-7893-99fe-0e2dcf64b2b5
---
§7.2.2 milestone `M2` of the `graph` card ([[f7e0b9dd]]), with its vocabulary amendment [[8950b1dd]].

Carried from graph M1's delta review:
- Moving `graph/measure/measure.worker.ts` updates the bundle entry `MEASURE_ENTRY` in `install/cut/release.ts`, which names the worker by path string, and its itest fake.
- `files/serveLogBound.ts` and `files/serveRecord.ts` go to composition; the card names no target files, so they are chosen at the move.
- `MeasureAsks` (plural, in `graph/measure/measureThread.ts`) has no ordered rename; only `MeasureAsk → MeasureRequest` and `MeasureReply → MeasureAnswer` are ordered.
- The card's line ranges for the `Doctor.ts` and `Sources.ts` splits have drifted from the code; re-derive them at the split.
- `graph/projects/holders.ts` dissolves: `heldTasks`/`HeldTask` stay graph's and move into a graph file of their own (card: `tasksHeld.ts`). `agentNames` goes to thread-record, and the `sessionNamesLayer` fill for graph's `SessionNames` port goes with it. `namedHolders`/`holderOf` go to change-record.
- First step, from wave-platform, after the K0 operation pairs landed in eb61e9e8a4:
  - `operations/{blocks,orientation,work,crossing,answers,routed}.ts` → `graph/operations/`, with every importer (`operations/index.ts`, `http/handlers/*`, `api/Api.ts`, `enforcement/*`, `operations/enforcement.ts`);
  - `operations/measure.ts` splits: `read_installation_status` → `operations/installStatus.ts`, the rest → `graph/operations/measure.ts`;
  - `read_owners` → `graph/operations/projects.ts`;
  - `sync_graph` stays until `files/TreeCommits.ts` is graph's;
  - then the manifest `graph/graph.ts` (`manifest({ id: 'graph', operations })`). Floor rule f49f228f keeps it out of `graph/` until the bodies are there.
- `graph/core/Act.ts` keeps an internal `BlockRows` tag after M1. `graphLayer` builds graph's own layers before `Blocks`, so they read rows through it. The `Act.ts`/`Blocks.ts` split decides where it ends up.

Divergences at finish: `projection/blockPage.ts` and `projection/evidence.ts` stay (their importers `toolAnswer.ts` and `lines.ts` sit on a lower floor); the `protocol/settings.ts` graph keys (`graphCommit`, `graphCatalogs`) stay until the local `key()` helper sits on a lower floor (settings [[dc77d42d]]); `DemoOwners` in `composition/testing/graphFixture.ts` is not dissolved; `Batch.ts` and `Instructions.ts` keep their names because the targets are case-only renames. D6's `project_policy` cut (graph card §5, §11) was missed here. It follows settings, owned by wave-providers.