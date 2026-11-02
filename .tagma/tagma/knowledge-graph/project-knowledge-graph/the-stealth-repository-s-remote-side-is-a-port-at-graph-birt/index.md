---
id: 01a193d9-9a1f-79e8-9f71-7a96e41dca93
title: "The stealth repository's remote side is a port at graph: birth, opening, storage moves, topology and commits ask it, and the core default answers none"
ord: 261
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a19371-bc70-7ecd-b2c5-96b9f492b72c
---
Paths under `apps/tagma/server/src/` unless stated. This is the first capability woven through core flows to become a port under [[f492b72c]], and the case that exercises the server and app seams together.

## What stands

- **One port at graph.** `GraphExchange` (`graph/contract/service/exchange.ts`, explanation [[17075e73]]) answers per project the side of a stealth `graph.git` — what a missing one is born from and the tracking-ref namespace topology follows — and takes the wakes after graph commits, accepted refreshes and copy openings. `ShadowGit.open` takes that side instead of an address, and every opener passes it: birth, opening (the team project's stealth layer attaches when `graph.git` stands or the side names a birth), recovery, twin renames, detached reads and storage moves. The pool hands the filler a host (`graph/serving/exchange.ts`): a project's stealth `graph.git`, branch following, `moved`, opening, and setting the graph aside for a restore.
- **The core default answers none.** A build with no filler births empty, reads no tracking ref and ignores wakes — the path a project with no remote always took. The graph's own tests run on `NO_SIDE`; `composition/testing/exchange.itest.ts` composes the core modules with a test filler that births from a bare repository, supplies `refs/remotes/sync/*` that topology fast-forwards the served tree to and seeds a new branch's twin from, and is woken after commits, all through the port and the host.
- **No remote address in core state.** Migration `20261101013059_drop_graph_remote` drops `project_policy.graph_remote`; the address left the policy row, the `Project` wire row, `ProjectPolicy`, `ProjectLifecycle.create` and `add_project`'s input. A filler takes what a new project's exchange needs through a contributed creation step, which runs before the first graph open.
- **Branch following stays core.** Twins, topology, stealth-merge recovery and the forward of branches no tree holds are the graph's, reached by the filler only through the host.

A filler from another root reaches the graph only through the port, the host and the core's exported entries.

## Acceptance

- With the core default, a stealth project births, opens, moves storage and follows branches as a project with no remote does today, and the graph's tests pass with no remote state.
- A contract-test filler inside this repository works through the port alone: it births a missing `graph.git` from a bare repository, supplies tracking refs that topology fast-forwards a tree to and seeds a twin from, and is woken after a graph commit.
- Project creation runs a contributed step before the first graph open, so birth from the remote still comes first ([[63d0dbeb]]).
- No core file reads or writes a remote address. A data directory written with `graph_remote` opens after the migration.
- Typecheck and the graph and projects tests pass.
