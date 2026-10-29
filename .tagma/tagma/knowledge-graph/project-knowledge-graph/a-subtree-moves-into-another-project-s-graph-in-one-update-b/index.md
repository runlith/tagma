---
id: 01a1791f-3e3a-7001-8f34-c91e7840a792
title: "A subtree moves into another project's graph in one update_block: names, state, edges, and law stay correct in both projects"
ord: 115
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/operations/relocation.ts
---
**Why.** A user splits a project in two, merges two into one, or recorded a knowledge branch in the wrong project. Today only a lone block with no children and no edges in initial status moves into another project's graph ([[c82c927b]]). A branch with tasks, rules, and modules must be taken apart block by block, losing statuses, holders, and edges. The closest consumer is the runlith split, but any Tagma user needs this.

**What the user gets.** The same `update_block <block> parentId <parent in another project's graph>` call moves the block with its whole subtree. There is no separate operation: inside a graph `parentId` already moves a subtree, and between graphs it does the same. The main path is the agent. The app outline shows one graph, so the interface never changes.

What survives:
- each block's name (uuid), so `[[name]]` in any graph's bodies leads into the new graph;
- title, body, tags, child order, creation and edit dates;
- status and holder; the holder's session translates through the target's session registry;
- all fields, including operation-written ones: rule enforcement with debt and escapes, rule delivery and enabled, module card id, entries, and order;
- sources with their old project-root paths.

Edges:
- between subtree blocks — the target's plain edges;
- from the subtree to blocks staying in the source graph — the target's addressed edges into the source graph;
- from the source graph's remaining blocks into the subtree — addressed edges into the target graph;
- the target graph's addressed edges into the subtree become the target's plain edges;
- other machine projects' addressed edges into the subtree are re-addressed to the target graph by an act in each such project's graph. Edges of projects whose index never reads or whose graph never opened are not re-addressed. The answer names such projects, and their edges read "not on this machine" until `unlink_blocks`.

## Order and failures

Preparation reads both graphs and judges everything depending on the source graph and the law before any write.

- **Each graph copy has its own store** (the working case). First the target births the subtree in one act under the old uuids, then the source graph removes it in one act. A process crash between acts leaves the subtree in both graphs and loses it in neither. The same call from the source project or with a `<project>/<name>` address completes the move: the target, whose copy matches the subtree, never births it twice. Copies diverged after a stop yield a `relocation-stale` refusal with the way out: delete the copy being dropped and retry.
- **Departure refused** because the subtree changed between preparation and departure. Then the target removes the born copy with the same departure, and the caller receives the original cause. If even that failed — `relocation-unfinished` with both addresses.
- **One store for several projects** (a server with no data directory, test worlds). Departure and birth run in one transaction.
- The source graph removes the subtree into the trash under fresh uuids, like a lone block today: otherwise the trashed copy would intercept the name in the source graph and collide with the unique uuid in shared storage.

## The target dictionary judges the block as born in it, but with its state

A move is not a transition: the block stands with the status and holder it had. The target checks the same as at birth:
- every tag declared. All missing tags are named by one `tag-undeclared` refusal with the "enable the catalog" or "declare your own tag" way out; in a new project without a catalog the move refuses until a catalog is enabled;
- fields and the status word pass the target's declarations, required fields stand, the body fits, ref fields point at allowed targets;
- each edge's kind and target are declared by the target's tags. An edge whose end kind changes is judged anew: the target's addressed edge turned plain — against the arriving block; the source's plain edge turned addressed — against the block's kinds in the target dictionary;
- sources are allowed for the tag (`not-measurable`), a symbol source anchors on the target checkout's symbol (`symbol-missing`).

Transition gates (`transition`, `open-children`), and edge standing and wait cycles, never repeat: they judge a move that already happened.

`#tag` and `#catalog` nodes never move (`relocation-shape`): the declaration holds the whole source graph's nodes, while catalogs and its own `#tag` nodes set the target's dictionary.

**Sources.** A source path counts from the project root and in the target means the same path from its root: when a project splits, code lands on the same paths. `source-outside` can never happen to a path the source graph accepted.

## Law

- **Whose dictionary.** The target dictionary decides which moved blocks become running rules and module cards in the target.
- **Inspection key.** A moved rule that runs (watch or gate) must find its inspection key in `tagma.config.ts` at the target checkout's HEAD. Otherwise a pre-write refusal, like `inspection-unknown` at `enforce_rule`: without the key the target's landings would fail `inspection-failed`.
- **Debt and its owner live in one graph.** A debt record's owner is the rule project's task or spec. If the rule leaves while its debt's live owner stays, or the owner leaves its staying rule — a refusal with way-outs: move them together or reassign the records through `enforce_rule` with `owners`.
- **Debt is never remeasured on move.** The target's background remeasure carries it the same way as a rule that arrived by graph merge: records missing from the target's code are extinguished, violations outside debt are recorded.
- **Module cards move as blocks, and each project's map is its cards.** `imports` and `imports-tests` links between moving cards survive. Links across the move boundary drop, because a project's map never names another project's module; the answer lists them. Each project's map after the move must hold under its running rules that take the map. Otherwise a refusal with the map problem and the `set_module` way out. A map broken before the move never blocks it.
- The graph knows no configs or inspections: it reads the project law through its own `ProjectLaw` port, filled by enforcement.

## Limits

- The project root never moves. A call with a `parentId` in another graph carries no other edits.
- `supersedes` and `amends` edges between the subtree and the rest of the graph refuse: replacements and amendments are written by their own operations inside one graph. Such pairs move together.
- The journal and git history stay in the source graph. The target records each block's birth, with the old dates inside the blocks themselves.

## Acceptance

Integration tests through the native `update_block` tool:
1. A subtree (spec, an in_work task with holder, a finished task, a rule with delivery, a note with source; edges inside, outward, inward, and a third project's addressed edge) moves between two projects of one world. Names, statuses, holder, fields, and sources survive, edges stand as described above, the source graph no longer knows these names.
2. A target missing a subtree tag means `tag-undeclared`, both graphs unchanged.
3. A move into another store's graph follows the same path: birth first, then departure.
4. A rule leaves without its debt's live owner — refusal, both graphs unchanged.
5. In a world with enforcement on two registered projects a rule with a key missing from the target's config refuses; a module card whose entry is open to the source project module refuses with a map problem; with the config fixed the card with the rule moves, and the third project's addressed edge re-addresses.
6. A move stopped between the two acts completes on retry; copies diverged after the stop refuse until one of them is deleted.
