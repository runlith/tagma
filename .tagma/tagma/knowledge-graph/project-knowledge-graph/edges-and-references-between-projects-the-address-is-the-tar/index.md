---
id: 01a159ae-2c87-7eea-be0d-532f4476383d
title: "Edges and references between projects: the address is the target graph's root uuid, an unreachable target is \"not on this machine\", and only an edge critical by declaration holds work"
ord: 84
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a11b65-f219-70d5-8e2c-66aac7c0b002
  - kind: relates
    to: 01a14c0c-6747-7325-a0f7-f79c508c4ca4
  - kind: relates
    to: 01a15666-29d3-7512-8c0c-71e28fa6e159
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/acts/measurement.ts
  - kind: file
    ref: apps/tagma/server/src/graph/blocks/linking.ts
  - kind: file
    ref: apps/tagma/server/src/graph/operations/blocks.ts
  - kind: file
    ref: apps/tagma/server/src/graph/search/selection.ts
  - kind: file
    ref: apps/tagma/server/src/graph/serving/routing.ts
  - kind: file
    ref: apps/tagma/server/src/graph/tree/blockFile.ts
  - kind: file
    ref: apps/tagma/server/src/graph/tree/mirror.ts
---
An edge or a reference between blocks of different projects: a frontend task waits on a backend task although the repositories differ and each graph reaches the team in its own git. The edge names the project by an address that is identical on every machine, and on a peer's machine it resolves to their copy of that project. Where the machine has no target, the edge neither changes nor disappears: Tagma says "not on this machine", and only the edge on which the choice of work depends by declaration holds that work.

## What stands now

- **Edges of one graph.** `Edges.assertEdge` (`graph/blocks/linking.ts`) refuses `cross-project` ("edges connect blocks of one project"), and `create_block` does the same in `resolvePeer` (`graph/operations/blocks.ts`). A mirror's `edge` row holds `to_id` as a foreign key onto `block.id` of its own copy, while in a block file an edge is `{kind, to: <uuid>}`. An edge whose uuid the copy does not know goes to `deadEdges` when the tree is read (`graph/tree/mirror.ts`) and never reaches the mirror.
- **`link_blocks.toId` is a mention.** The field is declared `blockRef`, i.e. of the `block` kind from [[8fa6e159]]: two mention fields in different projects would give `place-mismatch` before the graph ever reached `cross-project`. `create_block.edges[].to` already carries `blockMention`.
- **References `[[…]]` already cross projects, but not everywhere.** App navigation resolves a name through `read_titles` over the copy indexes of every project on the machine plus global ([[c7c0b002]]), so a click on a reference to another project's block opens it. But `ref` (`graph/acts/derived.ts`) is written only for names of its own graph, and `refsOut` in `read_block` supplements them only with global names (`globalNames`, `graph/reading/names.ts`). A reference to another project's block is not visible on the block's page, and the target has no incoming reference.
- **Global is not shared with the team.** The global root is born by `ensureGlobal` (`graph/serving/birth.ts`) anew on every machine, with its own uuid. The tree lives in the server's data directory (`storeDirectory/global`), storage is always `plain`, it stands in no checkout ("stands in no checkout", `graph/serving/checkout.ts`) and never moves. No code in graph sends it to another machine. So two peers have two different globals, and an edge into one machine's global never resolves on another.
- **Only the team graph travels over git.** Stealth and plain live in Tagma's data directory ([[da5f3f35]]). A peer's stealth-project graph is a different graph with a different root, even when the code repository is shared.
- **Identity in the registry is `repoKey`**, the root commit (`projects/identity.ts`, `rev-list --max-parents=0 HEAD`); for a directory without git, its path. The registry refuses a second project with the same `repoKey` (`duplicate-root`).

## The project address is the root block uuid of its graph

Edges and references name the target graph by its root uuid. In runlith that is `01a0bf97-a4f7-7e8b-bc09-a20c4d2ff254` — the `id` in `.tagma/runlith/index.md`. The choice is justified as follows:

- The edge points at a graph, not a repository, and this address lives in the graph itself. It travels over the same git as the blocks it points to, so "the project is here" means exactly "a copy of this graph is here". No new file with an id is needed: the root already carries a uuid minted when the graph was born.
- The address survives shallow clones, history rewrites, renames or remote changes, git-less projects, and storage moves: `set_project_storage` carries the whole tree files, root included.
- `repoKey` was rejected. In a shallow clone the root commit is the clone boundary, not the start of history. In a directory without git the key is a local path. A rewritten history gives a different key. And above all, the key names code, not the graph: a peer's stealth project has the same `repoKey` but a different graph, and Tagma would say "project here, block missing" although that graph's blocks are not there at all.
- A git remote was rejected. It differs between ssh and https, between a fork, a mirror, and after an organization rename, and a local repository has none.
- A graph that does not travel (stealth, plain, global) grows a root of its own on every machine. An edge into such a graph resolves honestly only on its author's machine, and on peers' machines it reads as "not on this machine". There is no separate rule for global: it is the same case, and it is not forbidden.

The address resolves to the registered project whose main copy holds the graph with that root; the target copy is the main one (`branch: null`), as the read row in [[508c4ca4]]. Worktrees of one project share the root, and they are copies of one project, not an ambiguity. Two registered projects with one root (e.g. a `.tagma` copied into another repository) are the `ambiguous` state: it reads with both projects and holds work the same way an unreachable target does.

## An edge in a `.tagma` file

An edge of one's own graph is written as now. An edge into another graph carries the address in the same `to` line:

```yaml
edges:
  - kind: relates
    to: 0199bbbb-0000-7000-8000-0000cafe0001
  - kind: waits-on
    to: 01a0bf97-a4f7-7e8b-bc09-a20c4d2ff254/0199bbbb-0000-7000-8000-0000cafe0002#backend
```

`<graph root>/<block uuid>#<label>`. The label is the target root's title at link time. It exists only to say "the target is in backend" when the machine has no graph; a resolved edge shows the project's live name. Reads never update the label: otherwise they would rewrite other blocks' files.

Why the address lives in `to` rather than a separate key: `decodeBlockFile` parses frontmatter with `onExcessProperty: 'error'`, and an old server would find a file with a new key unreadable — the whole tree with it. A `to` line matching no uuid it takes to `deadEdges` and keeps reading. The canonical order (kind, to) from [[209d36cc]] is preserved: equal edge sets on two branches give equal text.

**Graph shape step.** A new step in `graph/steps/` (name strictly after the last one, currently `20261020060000_rule_inspections`) translates nothing: old trees have no address edges. It raises `format.json`, and a server that does not know the step gets `vocabulary-newer` (`graph/serving/format.ts`): it reads but refuses writes. Without it, an old server would wipe the address edge at the first projection of the file — its mirror has no edge, and the file text is printed from the mirror ([[9cd335df]]). A peer on old Tagma sees such a graph read-only until they upgrade: that is the standing shape contract.

**Mirror.** A new copy table `far_edge (from_id → block.id, kind, graph, block, label)`, PK `(from_id, kind, graph, block)`, index `(graph, block)` for incoming edges. An edge with its own root's address becomes a plain `edge` row at parse; writing such an edge always takes the local form. `connectionRows`/`groupConnections`/`rowText` ([[9cd335df]]) print `to` for `far_edge` too; rebuild and repair parse the address form into `far_edge`, not into `deadEdges`. An edge that resolves nowhere stays a row: the mirror loses nothing for want of a target. Mirror migration is one new table; the mirror is derived from files, and `far_edge` rows are filled by the ordinary tree parse.

## Target resolution: owner and cost

The owner is `graph/serving`, where the copy index and `titlesAcross` live. The pool (`ServedGraphs`) carries the `ForeignBlocks` contract (`graph/contract/service/foreign.ts`) — what the machine knows about other graphs' blocks:

- `farStates(targets, contract)` — for (root, uuid) pairs: `here` with project, title, `trashed`, `superseded` and the status phase under the contract, or `absent` with a reason (`project` — no graph with that root; `block` — the graph is here but its main copy has no block; `unreadable` — the copy failed to read), or `ambiguous` with both projects;
- `farPointing(graph, uuids?, contract)` — edges from other projects' main copies leading into these blocks or into any block of the graph: source (project, uuid, title), kind, the source's phase, and copies that failed to read;
- `farOutgoing(graph, uuids, kind)` — wait steps out of another graph's blocks, for cycle walks;
- `graphRootOf(projectId)` — the project's graph root, for counting incoming edges at deletion.

All answers come from index queries in the same worker as `GraphPool.titles` (`graph/serving/copyIndex.worker.ts`): it holds read-only connections to the main copies' mirrors, reads each root, and answers one message per question; graphs are not opened, trees are not walked. The "root → project" map is not cached: each copy's root is read in the same message, so a recreated project graph never yields a stale answer. A copy without a mirror or without published phase words is opened by the pool once and asked again — only when the address was not found or a phase cannot be judged: the same rule as `crossing.elsewhere` in [[c7c0b002]]. The limits are the same: a cold copy answers with what it knew at its last serving, and a project whose graph the server never opened takes no part in incoming edges.

**Phase words in the mirror.** So the reader never loads the target's dictionary, each copy publishes into `meta` (`phase-words:<project>`) the status words of every phase under every contract of its dictionary — the same `TagTable.wordsAt` by which its own graph judges `contractAt` — together with the dictionary revision. `projectTypeIds` publishes in the same act where the dictionary revision grows, and `completeDerived` on copy open where the publication is missing or stale. A per-block phase column was rejected: every tag-word change would recompute all its carriers, while a publication changes in one row.

`projects` does not change. The registry keeps checkout identity (`repoKey`, path) and deletion news. The graph address is a graph fact: the graph derives and resolves it.

## Criticality comes from the declaration

An edge is critical when its kind carries behaviour with the `dependency` meaning (`BehaviourEdge.meaning`, `TagTable.semanticEdges('dependency')`). There is one such kind in code: `waits-on` of the `core/work` contract (`graph/work/tasks/workBehaviours.ts`). Any tag that binds `core/work` gets it, shipped or custom. The contract declaration decides, never the person on the spot.

What such an edge holds in code now and after the change:

- **`blocked`** (`graph/acts/measurement.ts`) and through it **`ready_work`** (`readyFrontier`, `graph/search/selection.ts`), the orientation frontier and the prime count. A task in an initial phase is blocked while at least one of its `waits-on` targets is not in a terminal phase, not trashed, and not superseded. For an address edge `farStates` judges the same. An `absent` or `ambiguous` target is unknown, hence not proven finished: the task is blocked.
- **Wait-cycle check at link time** (`assertNoCycle`). The walk follows `waits-on` edges across graphs: the local rows and `far_edge` of its own copy, the target copy's edges by index. A walk branch heading into a graph that is not here breaks off, and the link does not refuse: there is no proof of a cycle. A cycle assembled by a merge from two machines reads the same as today's two-branch cycle of one graph: both tasks are blocked.

`claim_block`, `finish_block` and `close_block` read no edges — neither their own nor others': a blocked task can be taken today. This spec adds no such gate: it would change behaviour for single-graph edges too. The rule for any gate that reads a critical edge: an unreachable target judges as unfinished, and the refusal is `target-absent` (code, reason "target 3fa2b1c0 in backend, it is not on this machine", unblock below). The question of such a gate is [[9aac660c]].

Not critical: `implements` (`implementation` meaning) — it only gives the spec its `building` mark and the `standing` check at link time; `relates`, `validates`, `imports*` and `discovered-from`. Such edges hold nothing and never disappear. The `building` mark counts edges of its own graph: counting incoming `implements` from other projects on every measured read would cost a query over every copy for every tree read, and the mark is only shown. `supersedes` and `amends` stay single-graph edges: their operations own them, and `supersede_block` still refuses `cross-project`. For the same reason answering an observation (`answer_reflection`, `uphold_amendment`) does not cross graphs: those operations own their contract.

## What ready_work sees

A task with an unreachable target does not enter the frontier. The answer carries `held` — one group per unreachable graph: the mark or project name, the number of tasks, the page's task names, and the contract, identical to the gate refusal:

- `code: 'target-absent'`;
- `reason`: "3 tasks wait on backend blocks, it is not on this machine";
- `unblock`: `add_project <backend checkout root>` — open the project if its clone exists — and `unlink_blocks <task> waits-on <target>` — explicitly unlink the edge in the graph where it lies.

The cost is the set of "externally blocked" tasks, computed once per read. Measurement takes every `far_edge` with a critical kind from its own graph (usually dozens), asks `farStates` in one batch per target graph, and hands the SQL `blocked` a ready id set. So the filter and the `total` stay in SQL instead of being finished after the page.

## Reads and the block screen

`read_block`, `edgesOut`/`edgesIn`: an edge row into another graph carries `graph`; an edge of its own graph has no such field. `graph` is `{ project, projectId, state: 'here' | 'absent' | 'ambiguous', title, reason }`: `project` is the name on this machine or the mark, `title` the target's title where it is here. Incoming edges from other projects come from `farPointing` over main copies and stand in `edgesIn` with the source's project. The block name prints as now (`blockName(uuid)`), the project separately. Page voice:

```
→ waits-on 3fa2b1c0 · backend "Give the order list"
→ waits-on 3fa2b1c0 · backend — not on this machine
← 7c1d2e3f · frontend waits-on
```

A row's `blocked`, as now, is one measurement. The edge itself names the reason.

`read_edges` returns the project's edges, address edges included, with the same `graph` field. It does not return others' incoming edges: those are other projects' edges.

The block screen (`BlockPage`, relations section). An edge row into another project carries the project's mark and opens in it, as a reference with the address from the answer ([[508c4ca4]]). An unreachable target's row is dimmed and leads nowhere: "3fa2b1c0 · backend — not on this machine". A critical row carries one action beside it, "Unlink", i.e. `unlink_blocks` of that edge.

## Linking and unlinking

- `link_blocks.toId` and `unlink_blocks.toId` become `blockMention`; `create_block.edges[].to` already is one. The act's place is the `fromId` graph, and only it is written: the source's file and its journal. The target graph's law is not delivered, because the target does not change. This rests on [[8fa6e159]] with no new form: another project's block is a mention, not a matter.
- `assertEdge` judges a cross-graph target's kind by the source's dictionary, as now. `rule.to` and `standing` judge by the target row in its graph (`atTarget`, `crossing.ts`): that is a write act, and opening the target graph for it is legitimate. A `to: [tag]` declaration limit compares by permanent type id (`block_tag.type_id`), not by tag name, because two projects' tag names differ. The target carries its types' ids with their ancestors by its target dictionary: a descendant of a permitted type in another project passes the same as in its own graph. The `cross-project` refusal leaves `link_blocks`, `create_block`, `unlink_blocks` and their descriptions.
- `unlink_blocks` resolves `toId` first among the `fromId`'s own edges, `far_edge` included, by uuid tail. So an edge to an unreachable target unlinks by the name the read printed. A block reached by an edge over several addresses (e.g. after a move into another graph) loses all of them: the name names the block. Unlinking is an ordinary act: an `unlink` event in the source journal, authored by the session. Peers see the file change in the graph commit under their graph.commit policy.
- Moving a block into another graph (`relocate`) still takes only a block with no edges ([[c82c927b]]). Now it also counts this machine's incoming address edges (`farPointing`): another graph's edge with the old address would read as `absent` after the move.
- Tagma never frees or deletes an edge itself: not on project deletion, not on checkout wipe, not for want of a clone. The mirror keeps its row; the file keeps its text.

## Boundaries

- Incoming `[[…]]` references from other projects (`refsIn`) are not counted: a reference is navigation, and that would need a raw-name index in every copy. Outgoing ones are in [[6c7c8f6e]].
- The graph feed (`graph/journal/feed.ts`) does not wake another project's readers when their blocker ends. Blocking is recomputed at the next read.
- An edge from another project's branch (worktree) is not visible in incoming edges until merged into the main copy: `farPointing` reads main copies only.
- `apply_batch` stays one store per document: its `link` and `create` with `edges` bind blocks of its own store; `link_blocks` and `create_block` write edges into another store's graph.
- App: besides the `BlockPage` relations section and the reference row from [[6c7c8f6e]], no screens change.

## Acceptance

The performer proves with integration tests on two team projects A and B (`demoGraphLayer`, two repositories), through public operations:

1. `link_blocks` of A's task `waits-on` B's task passes. A's block file carries `to: <root B>/<uuid>#B`, A's `read_block` shows the target with B's project and title, A's `ready_work` does not return the task, and after B's task `finish_block` it does.
2. A second clone of repository B, registered in place of the first, resolves the same edge: the address is the graph root, not the path and not the `repoKey`.
3. After B's `remove_project` A's file is unchanged. A's `read_block` shows the target `absent` with B's mark, A's `ready_work` returns `held` with `target-absent` and both exits. `unlink_blocks` by the printed name unlinks the edge, and the row leaves the file.
4. A `relates` edge to an unreachable target reads with `state: 'absent'` and holds nothing.
5. B's task `read_block` shows the incoming `waits-on` from A.
6. `create_block` with `edges` into block B passes; `link_blocks` `waits-on` closing a cycle through B refuses `wait-cycle`. `supersede_block` between A and B still refuses (`place-mismatch`: two matters in different graphs).
7. A block-file codec unit test: an address `to` parses and encodes back to the same text, a local one unchanged. A tree-read test: an old tree passes the new step with no file changes.

Measured on a trial server (`tagma:try`, the [[508c4ca4]] fixture, 8 projects, B cold with a mirror): `read_block` with address edges and A's `ready_work` — p95 < 100 ms, and among the call's spans there is no `GraphPool.resolve` of project B.

## Coverage and order

- Address, file shape, step and mirror, resolution, criticality, ready_work, reads and screen, linking, operation place, global, performance, proof — this node.
- Project deletion with incoming-edge counting — [[aa0ffc24]].
- `[[…]]` references between projects — [[6c7c8f6e]].
- Standing area tasks: [[8a8a3eda]], [[d0051b98]], [[3751ed77]], [[efc6a9fe]] — this spec does not touch them; they stay. The open [[508c4ca4]] — its copy index is shared here: `ForeignBlocks` reads through the same worker.
- Rights and approval: the act writes only the source graph and is approved as an edge of its own graph ([[1013e071]]).

Build order: this node first, then [[6c7c8f6e]] and [[aa0ffc24]] independently.
