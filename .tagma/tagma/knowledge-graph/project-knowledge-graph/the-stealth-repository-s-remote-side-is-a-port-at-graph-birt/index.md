---
id: 01a193d9-9a1f-79e8-9f71-7a96e41dca93
title: "The stealth repository's remote side is a port at graph: birth, opening, storage moves, topology and commits ask it, and the core default answers none"
ord: 261
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a19371-bc70-7ecd-b2c5-96b9f492b72c
---
Paths under `apps/tagma/server/src/` unless stated. This is the first capability woven through core flows to become a port under [[f492b72c]], and the case that exercises the server and app seams together.

## What stands

- A stealth repository's remote exchange already sits behind `GraphRemotes` (`graph/contract/service/remote.ts`). `makeGraphRemotes` (`graph/serving/remotes.ts`) fills it over the git plumbing in `graph/storage/remote.ts`.
- Its address is core state: the `graph_remote` column of `project_policy` (`graph/store/policy.ts`), and `graphRemote` on the policy row, on the `Project` wire row and in project creation's input. 22 non-test files under `graph/` and `projects/` carry it.
- Core flows branch on the address with no step to join:
  - `ShadowGit.open(gitDir, git, origin)` births a missing `graph.git` from it, and every opener passes it (`serving/birth.ts`, `open.ts`, `attach.ts`, `recovery.ts`, `twinning.ts`, `pool.ts`, `storage/move.ts`);
  - opening attaches the stealth shadow when a remote is set;
  - a storage move returns early only when there are no hidden blocks and no remote;
  - topology fast-forwards a tree to the remote tracking branch, or seeds a new twin from it.
- The pool builds the exchanger unconditionally and wakes it after act commits and on freshness.

## What will stand

1. **One port at graph for the remote side of a stealth repository.** For each project it answers three things: what a missing `graph.git` is born from, which remote tracking refs topology follows, and whom to wake after a graph commit or opening. `ShadowGit.open`, opening, storage moves and topology ask the port instead of taking an address argument. The port is phrased as exchange in general, so a self-hosted sync can fill it as well.
2. **The core default answers none.** That is the path `origin = null` takes today, so with no other filler the core births, opens, moves and follows branches exactly as a project with no remote does now.
3. **No remote address in core state.** A migration drops the `graph_remote` column. `graphRemote` leaves the policy row, the `Project` row and project creation, which carries a filler's input through the `contributed` map of [[0ac072c1]], item 5. A filler keeps its own state in its own store (item 7) and follows project removal and moves through the existing `thread-record/home-followers` and `platform/relocations` points.
4. **Branch-following stays core.** Twins, topology and stealth-merge recovery behave the same with or without a filler.

## Acceptance

- With the core default, a stealth project births, opens, moves storage and follows branches as a project with no remote does today, and the graph's tests pass with no remote state.
- A contract-test filler inside this repository works through the port alone: it births a missing `graph.git` from a bare repository, supplies tracking refs that topology fast-forwards a tree to and seeds a twin from, and is woken after a graph commit.
- Project creation runs a contributed step before the first graph open, so birth from the remote still comes first ([[63d0dbeb]]).
- No core file reads or writes a remote address. A data directory written with `graph_remote` opens after the migration.
- Typecheck and the graph and projects tests pass.
