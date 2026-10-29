---
id: 01a159ae-2c87-7eea-be0d-53316c7c8f6e
title: A [[name]] link to another project's block shows on the block's page, opens in its own project, and reads "not on this machine" when missing
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a11b65-f219-70d5-8e2c-66aac7c0b002
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/reading/block.ts
  - kind: file
    ref: apps/tagma/server/src/graph/reading/names.ts
---
A `[[name]]` link to another project's block shows on the block's page where its links show, opens in its own project if the machine has it, and honestly reads "not on this machine" when it does not. The body text never changes: the link stays a name.

## What stands now

- App navigation finds a name over all machine projects' and global's copy indexes (`read_titles`, [[c7c0b002]]), and a click opens the other project's block.
- `ref` (`graph/acts/derived.ts`) is written only for own-graph names. `refsOut` in `read_block` (`graph/reading/block.ts`) completes them with global names only (`globalNames`, `graph/reading/names.ts`): a link to another project's block never shows on the block's page.
- A name found nowhere is never named by the page, and the app captions the dead link "No such block in this project".

## Decision

**The link stays a name, with no project address in the text.** A name is a uuid tail, and a block uuid is unique everywhere, so at a colleague's the same name finds the same target in their copy of the project. An address in the body text (`[[01a0bf97…/3fa2b1c0]]`) is rejected: humans and agents write and read bodies, and the author can label the project with a signature anyway (`[[name|backend: orders]]`). The decision's price: an unreachable target can never say which project it is in, only that this machine lacks it.

- Names missing from the own graph are searched by `refsOut` first in global (`globalNames`, as now), then in the machine's other projects over the copy index — the same `ServedGraphs.titles` as `read_titles` (`elsewhereNames`, `graph/reading/names.ts`). What is found in another project stands in `refsOut` and in `refsElsewhere: [{ name, project, projectId, branch }]`: `branch` names the worktree if the block lives only there, `null` for the main copy, so leaving the page leads into the same copy the body's link means.
- `refsAbsent` — body names found in neither the own graph, nor global, nor any copy of other projects. A name counts as absent only when every copy read: with a copy that never read or never indexed, it lands nowhere — saying "no" would mean guessing.
- A name finding blocks in two projects lands in neither `refsOut` nor `refsAbsent`: reading a page never refuses over a body link, and `read_titles` separates such names with `ambiguous-name`.
- The page's voice: `refs → 3fa2b1c0 · backend, 9d1e0a42 — not on this machine`.
- App: the `BlockPage` links section shows a link into another project with the project's mark and opens it there, and a `refsAbsent` link dimmed, with no crossing. A body's dead link is captioned "Not on this machine" (`blockRefView.ts`): the name search already runs over all machine projects, and the old "this project" caption lied.

## Boundaries

No `refsIn` from other projects are counted ([[4476383d]], "Boundaries"). A link holds nothing: it is not an edge.

## Acceptance

Integration test on A and B (`composition/testing/graph/farEdges.itest.ts`): block A's body links to task B and to a name found nowhere. `read_block` of A yields task B in `refsOut` and in `refsElsewhere` with project B, and the nonexistent name in `refsAbsent`.
