---
id: 01a159ae-2c87-7eea-be0d-5330aa0ffc24
title: Removing a project names incoming edges from the machine's other projects and unlinks them only on the operator's word
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/contract/wire/operations/registry.ts
  - kind: file
    ref: apps/tagma/server/src/graph/operations/registry.ts
---
When the operator removes a project from Tagma, the answer names how many edges from this machine's other projects lead into its graph and how many of them hold work. They can be unlinked with the same act, one "yes" (`unlink`). Without it the edges stay as they are ([[4476383d]]): removal is a local fact of the machine.

## What stands now

`remove_project` (`graph/contract/wire/operations/registry.ts`, `'machine'` place, HTTP and CLI doors) removes the project from the registry and the commit gate from its checkout. `RemovalHold.check` refuses `project-not-empty` while holders hold anything: the graph's `treeHold` holds the project while its on-disk tree carries live knowledge. So a project with tasks removes once its checkout is erased or the tree is empty. The app has no registry-removal screen: "remove" in the project feed only hides it from the panel. Removal goes through `tagma project remove`.

## What stands after the change

- **Count.** `read_project` answers with a `pointing: { edges, holding, byProject: [{ project, projectId, edges, holding }], unread }` field. `pointingInto` gives it (`graph/acts/far.ts`): the project's `graphRootOf`, then `farPointing` over that root — one indexed selection per main copy of every other project. `holding` — edges of a critical kind (the `dependency` meaning from the behaviour registry) whose source stands in its contract's initial phase and is unreplaced: only those hold work. `unread` names projects whose copy never read or whose phases nothing can judge even after opening the copy: their edges count into `edges` but not into `holding`.
- **Act.** `remove_project` takes `unlink?: boolean` and always answers `pointing` — the incoming count at removal time — and `unlinked`. First it removes the project: a `RemovalHold` refusal touches nobody's edges. With `unlink: true` every incoming edge then unlinks through a plain `unlink` act in the source's graph (`Edges.unlinkFar` in its copy), signed by the caller. Acts in different graphs never roll back together: if unlinking refused, the project is already removed, the refusal goes to the caller, and the remaining edges read as "not on this machine" and unlink through `unlink_blocks`.
- **CLI.** `tagma project remove <project> [--unlink]` prints the whole answer, with the count.

## Boundaries

Only this machine's projects with an indexed main copy count. Colleagues' edges from their clones are invisible to this machine. An edge from another project's branch, not yet merged into the main copy, does not count. The app's removal screen is not part of this work: there is none for the removal itself either.

## Acceptance

Integration test on A and B (`composition/testing/graph/farEdges.itest.ts`): task A `waits-on` task B and task A `relates` to the same task. `read_project` of B answers `edges: 2, holding: 1`. After erasing B's checkout, `remove_project` of B without `unlink` removes it, leaving A's file unchanged; the wait reads `absent`, `relates` holds nothing. B's clone, registered under another name and path, answers the same edges. Its `remove_project` with `unlink: true` answers `unlinked: 2`, and B's address is gone from A's file.
