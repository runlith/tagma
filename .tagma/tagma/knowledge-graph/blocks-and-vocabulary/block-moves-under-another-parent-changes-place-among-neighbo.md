---
id: 01a14bc5-0df5-77c8-b1a2-692c885d68e2
title: Block moves under another parent, changes place among neighbours, and moves to another project's graph with the subtree under the same names
ord: 2
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-692dbb2a8aea
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-69419b982509
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-6947519b9f89
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/blocks/arrival.ts
  - kind: file
    ref: apps/tagma/server/src/graph/operations/blocks.ts
  - kind: symbol
    ref: apps/tagma/app/src/lib/features/graph/TreeScreen.svelte.ts
    symbol: TreeScreen
  - kind: symbol
    ref: apps/tagma/server/src/graph/blocks/trash.ts
    symbol: trashLayer
  - kind: symbol
    ref: apps/tagma/server/src/graph/operations/crossing.ts
    symbol: findTarget
  - kind: symbol
    ref: apps/tagma/server/src/graph/operations/relocation.ts
    symbol: relocate
---
**Value.** Knowledge is rearranged to where it belongs, subtree included. A branch recorded in the wrong project, or a product part moving to another repository, moves to the needed graph whole, with links unbroken.

**How.** `update_block` with a new parent and position; a parent from another project's graph means a move. In app outline — nest, unnest, and shift a row with the keyboard inside one graph.

**Behaviour.**
- Inside a graph the subtree travels with the block; with no position the block stands last. An empty parent puts the block under the project root.
- To another project the subtree moves whole. Names, statuses, holders, fields — including the ones operations write — sources, and dates are kept. The name and `[[name]]` links now lead to the new graph — also on a colleague's machine that pulled the old project before the new one: a row his mirror put in the trash never intercepts the name.
- The new graph checks every block against its own dictionary but does not replay status turns. It names every missing tag with one refusal.
- Edges inside the subtree stay ordinary, edges across its boundary become cross-project edges. Other projects' edges on this machine re-point to the new graph; the answer names the projects whose edges failed to re-point.
- Law moves with no loss and no gate bypass. A rule moves with its debt's owner. A running rule needs its inspection in the new project's config. Module links across the move boundary are removed, and each project's module map must keep holding.
- A failure between graphs does not lose the subtree: it can stay in both, and a repeated call from the source project completes the move.
- Journal and git history of the blocks stay in the source graph; a copy under new names stays in the trash there.

**Limits.** A move call carries no other edits. The project root, dictionary nodes (`#tag`, `#catalog`), and `supersedes` edges across the subtree boundary never move. Inside a graph only `set_module` moves a module. A block cannot be put under its own descendant or under a leaf. The interface shows no cross-project move: it goes through an agent and operations.
