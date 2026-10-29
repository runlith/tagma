---
id: 01a15666-29d3-7512-8c0c-71e28fa6e159
title: "An operation's place derives from its subject by entry-field type: a block, path, checkout, worktree, and thread each place the call in their own project"
ord: 7
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a126b3-84d8-7b0e-a605-99311013e071
  - kind: relates
    to: 01a15652-c9cb-7efd-8c4f-471f7769efcd
sources:
  - kind: file
    ref: apps/tagma/server/src/invocation/admission/place.ts
  - kind: file
    ref: apps/tagma/server/src/platform/contract/wire/operation.ts
  - kind: file
    ref: apps/tagma/server/src/platform/contract/wire/place.ts
---
The agent names what it acts on — a block, a file, a checkout, a worktree, a thread — and the call itself goes to that subject's project and copy: with its graph, law, line accounting, and gates. The agent writes `project` only where there is no subject. An operation cannot "forget" its subject: the place derives from the entry field's type, not from the body code, and the catalog check fails on a subject-like field whose type does not say what it is.

The home-and-place model is written in [[1013e071]] and stands: the thread's home owns the actor, the feed, questions, scratch; the act owns the place derived from the subject. This spec does not change that model; it moves the "place from subject" rule from operation bodies into their declarations, where it can be checked across the whole catalog.

## What stands now

`operationFacts` (`invocation/admission/place.ts`) picks the place from three sources: an explicit `project` (an entry field, if the operation declared `place: true`, or the transport's `--project`); a subject, if the body named it (`Bound.place`) or the operation declared `subject: 'file'` with `subjects()`/`Bound.files`; otherwise the environment — the calling cwd, the checkout the thread stands in, the home. There is a heading in the original for this paragraph; the three sources are: explicit project, subject, environment.

A subject is an optional body hook. Graph operations get it through `targeted(...)` (`graph/operations/crossing.ts`), `check_law` and `submit_work` through `selectCheckout`, `read_gauges` from a cursor. An operation without a hook silently stays home. Inside it, everything reading the call's services (`CurrentProject`, `GraphCall`, the law graph `ownGraph` in `Orientation.ruleReach`) reads the home, even though `scoped()`/`locate()` already found someone else's block in its graph. That is how [[7769efcd]] happens: `check_law` finds law-lab's rule, but counts its reach over runlith's graph and refuses with a false `reach-empty`.

The second path — the body itself finds its place by its own field and then passes the found place's project along (checkout actions by `rootId`, [[2086e7fd]]) — works, but the call still stands at home: the place's law is not delivered, and everything the body takes from the call's services is home (the holder labels in `read_checkout` are read from the home graph).

One operation at a time was patched ([[762f1514]] added `project` to `enforce_law`, `write_setting`, and their reads). The catalog inventory at `57eabe825a` is in [[85742042]]: of 389 operations, 22 have a subject but derive no place from it; 56 thread operations demand `project` for another home's thread; five project operations have no `project` field at all.

Delivery of a foreign place's law over HTTP/MCP (`perform.ts`, the `law-unread` refusal) fires only if the operation has a `project` field or the call named a project. An operation placed in a foreign place by its subject delivers no law.

## What will stand

### A subject is a field-type property

The subject's owner declares its field's schema once, with the subject kind in the annotation: both admission and the catalog check see the schema. Kinds and their resolving owners:

| Kind | Schema (owner) | Gives |
| --- | --- | --- |
| `block` | `blockRef` (`graph`) | the project and graph copy holding the block |
| `path` | a file or directory path (`workspace`) | the checkout containing the absolute path (`CheckoutPaths.placeAcross`); a relative path is a value in the calling project, because `read_owners`, `read_gauges`, and `search_blocks.path` read the path from the project root by contract |
| `checkout` | a checkout or worktree root: the root id or an absolute path (`workspace`, `RootId`) | that checkout and its project (`CheckoutPaths.rootAcross`) |
| `thread` | a thread id (`threads`) | the thread's home |
| `cursor` | a `placedCursor` (`platform`) | the `projectId` and checkout the page owner put into its question; a cursor without them sets no place |

`placedCursor` is the `PAGE_CURSOR` from `@runlith/paging` with a `cursor` kind, resolved by that same kit's `cursorSelection`, which knows nothing of the walk: the body still checks the cursor for `cursor-stale`. A single-project data page puts `projectId` into its question so that continuing from another place refuses `cursor-stale` instead of answering with someone else's project's data.

Block resolution gives the address of the copy found by the name index (`titlesAcross` in `graph/serving/routing.ts`): the current copy, then the rest of its project's copies, then every machine project's copies, and global ([[c7c0b002]]). Today's `crossing.locate` is unfit for this: `findTarget` takes the local match before all others, and `elsewhere` looks for someone else's block only in the main copy (`indexHolding` takes canonical lines), so a block that exists only in worktree B cannot be found from A. This fix belongs to graph: `locate` and subject resolution read one address answer from the name index. Ambiguity is judged within one step: a short name matching in the current copy and in another project takes the current one, as now.

The annotation and the kind union live in `platform/contract/wire/place.ts`. Resolution is a `SubjectPlaces` port (`platform/contract/service/place.ts`): `of(kind, value) → Place | null`; the kind owners fill it, composition wires it (rule e090f46d). `invocation` knows neither how a block nor how a path resolves, and enumerates no owners.

Next to the subject kind, the owner declares a **mention** schema, which sets no place: the block name in `read_titles.names` and `read_block.blockIds` is read in its own graph through `cross`/`atTarget`, as now. A mention may only be a field if the body reads or changes each of its values in that value's own graph and takes nothing about it from the call's services. The move-target address is declared the same way: `update_block.parentId` from another graph triggers `relocate`, which births the block in the target graph under its gates ([[c82c927b]]). The call's place is the moved block's graph; the target's law is not delivered — as now. All other entry lines are **values**: a path relative to the project (`source`'s `ref`, `reanchor_path.from`), `project` in `write_command_rule` (the rule's scope, not the call's place), the new project's `name`.

The `Bound.place` hook stays for a place the body computes itself: the single checkout with the session's lines (`selectCheckout` in `submit_work` and `check_law` over change). It picks a checkout inside the project named by the subject fields, and does not compete with them: `check_law({over: 'change', rules: [rule B]})` with the session's lines in worktree B judges worktree B, not the main copy the rule would have led to ([[b52845fa]], [[8d36f8af]]). The `place` hook in `targeted` and the `cursorPlace` in `read_gauges` and graph walks go away: these are subject fields. Checkout and worktree action bodies still read their own root by `rootId`, but the call already stands in that root's project. `selectCheckout` gets the subject fields' project through `SubjectProject` (`platform/contract/service/place.ts`): another project's cwd does not pick a checkout then, and the session's lines in other projects do not yield `multiple-checkouts`.

### Declaring an operation's place

`place?: true` and `everyProject?: true` in `OperationShape` (`platform/contract/wire/operation.ts`) are replaced by a mandatory `place` field with one of the shapes:

- `'project'` — place in a project: from the entry's subject fields, if present and named; without them from `Bound.place`, an explicit project, then the environment. Project-wide operations belong here too: a court over the whole project, reading all rules, settings, listing worktrees, the project's MCP servers. No separate shape is needed for operations without subject fields: what is a subject is said by the field's type, not by the operation's shape;
- `'home'` — the place is always the calling thread's home, `project` is not accepted: its own commands, terminals, calls, agent roster, files, and transcripts, which the operator opens from their own window. An operator's call has no home, and the place is the environment project;
- `'machine'` — no place: accounts, adapters, plugin installation, the project registry. Such an operation's body cannot require `CurrentProject` and `GraphCall`: both carry the `PlaceScoped` mark, and `pair()` does not assemble a `'machine'` pair whose `execute`, `prepare`, or `place` requires them. `CurrentGraph`, `CallPlace`, and `ServedTree` are `Context.Reference` with a default value, absent from the effect requirements, and the typecheck does not see them;
- `'fixed'` — the act's owner picks the place, and the call's explicit project stays provenance: reflections, whose place is Tagma's source graph ([[666b6be5]]); formerly this was `everyProject`.

The `project` field is one `projectField` schema from `platform/contract/wire/place.ts` with one description; the declaration sets it itself, and the catalog check holds the rule: `project` is on every `'project'`-shape operation without a mandatory subject (`create_block` without `parentId`, `search_blocks` without `path`, `check_law` without `blockId`, `checkout`, `root`, `set_module` without cards) and is absent wherever the subject is mandatory (`read_block_log`, `enforce_law`, `merge_worktree`): the subject already names the project, and an explicit project could only contradict it.

### Picking the place on a call

`operationFacts` derives the place in this order, identical for native, HTTP, socket, `tagma op`, and MCP:

1. An explicit project — the `project` field or the transport's `--project`. Without a subject it is the place (the main copy or the named branch).
2. Subject field values. All subject fields of one call, including nested ones (`enforce_law.owners`, `set_module.modules[].block`) and lists, must yield one project. Otherwise the `place-mismatch` refusal names both fields with their projects and resolves one: split the call. A checkout call sets one `path` or `checkout` field; a root-list field (`clean_up_worktrees.rootIds`) sets only the project, and each root stays its own checkout inside it, as now. A block sets the project and the graph copy; a path sets the code checkout; a code checkout and a graph copy of one project do not argue.
3. `Bound.place` picks a checkout inside the project given by steps 1–2, or the project itself without them. A different project than steps 1–2 gives `place-mismatch`.
4. The environment: the calling cwd, then the checkout the thread stands in, then the home. The environment is not intent ([[b52845fa]]): a subject overrides it without refusal.

An explicit project contradicting the subject refuses `place-mismatch` before prepare, as now; neither side is picked silently. A short block name matching in two projects at one lookup step refuses `ambiguous-name` with candidates, and the way out is a longer name, not `project`.

A project counts as explicit only when the caller named it. Today HTTP admission itself makes the cwd-found project explicit: `admitProject` (`invocation/admission/project.ts`) puts it into `caller.project`, and `operationFacts` takes it for the transport's `--project`. So a call of thread A from a cwd in B over a subject in C would refuse `place-mismatch`, though it should go to C, while the native door, where `project` stays empty, would go to C. Admission keeps the environment project apart from the explicit one, and `CallerAim.project` carries only the explicit one.

Resolution runs over the indexes that already exist: a block name over the copy indexes without opening graphs ([[c7c0b002]]), a path and a root over the machine's checkout coverage ([[2086e7fd]]). `targeted` already does this lookup at admission, so the call costs no more. Extracting the subject fields from the entry schema is built once per operation when the registry assembles, not by walking the AST on every call.

### The call's services and the "current graph" inside an operation

The call's services are built for the picked place, and only in `invocation` (rule 4657a163). So everything the body reads from them — the law graph `ownGraph` in `law.ruleReachOf`, `moduleMapOf`, `measuredRoot`, `HolderLabels` — belongs to the place without patching those readers: `check_law` over law-lab's rule sees the reach in law-lab's graph, because the call stands in law-lab. Patching `ruleReachOf` to open the rule project's graph is wrong, and would be a second derivation of the place (rule 51c66cb6).

`crossing.locate` remains the mechanism for mentions and paths outside a subject (batch-document bodies). For subject fields it finds the block in the place's graph, because the place is already set by it.

### The place's law and approval

Entering a foreign place (`WorkPlaces.enter` in `perform.ts`, the `law-unread` refusal with law delivery) depends on the picked project not being home, not on the presence of a `project` field. Place approval does not change ([[1013e071]]): reading asks nothing, writing asks where it would have asked at home.

### What the agent sees

- In tool descriptions, `project` appears only on operations where the subject may be left unnamed, and the description says the subject replaces it. Thread reads lose the phrase "a thread in another project refuses"; with `read_owners`, `read_gauges`, `search_blocks.path`, and `read_path_exists`, an absolute path in another project works, as their `source-outside` refusal already promises.
- The `place-mismatch` refusal names the fields and projects of both sides; its ways out: drop `project`, name the subject in it, or split the call.
- Refusals that lied about the reason because the call stood at home disappear on their own: `reach-empty` for a rule with a source, `not-found` for a block, root, and worktree, "in this project" for another project's worktree, the empty `read_repositories` over another project's path.
- The "Threads Are Read as Evidence" doctrine ("a foreign-project refusal names the home to pass") is rewritten by the same change: a thread reads in its own home by id on its own.

## Recorded decisions this changes

- [[1013e071]], the line "threads: reading, birth — an explicit `project`": reading and acting on an existing thread by id get their place from the thread. Birth (`spawn_agent project`) stays explicit: the child has no home yet. The reason: a thread id is machine-unique, and demanding its home means making the agent repeat what the server knows.
- [[762f1514]] gave `enforce_law` a `project` field. For `enforce_law`, `read_enforcement` with `rule`, and every operation with a mandatory block, it goes away: the block names the project. `read_enforcement` and `set_module` take the `'project'` shape with optional subjects (`rule`; `modules[].block` and `parent`), so `project` stays on them, and a module card of B without `project` puts the call in B. `read_inspections`, `read_settings`, `write_setting` take the `'project'` shape.
- [[2086e7fd]]: "the holder and the act come from the calling project" is fixed by the same change. The calling project becomes the checkout's project; the holder and the act's record stay home, because they belong to the actor, not to the calling project.
- The `read_repositories` description ("a store no coverage of this project reaches is absent") changes: a path puts the call in the project covering that store, and the answer names it. Hiding one's own machine's store from one's own agent is pointless: the risk boundary is not the project here ([[1013e071]], rule 0f144655).

## Why this way

- A subject lives in the field's type because the type already stands on every entry and both admission and the check see it. A body hook is invisible until the call — which is how `check_law` was missed.
- A mandatory `project` field on every operation with a place was considered. Rejected: the agent would repeat what the server knows from the block or path, and clashing two addresses would yield new refusals. The operator directly asked for no extra arguments.
- A per-operation "field → kind" list in each operation's declaration was considered. Rejected: it is a second place that gets forgotten like the hook; a field's kind is the same in every operation where the field appears.
- Patching "current graph" readers (`ruleReachOf` opens the rule project's graph) was considered. Rejected: one place for the call but readers in several — the same coordinate mixup, one level deeper ([[8d36f8af]]).

## Boundaries

- Entry documents (`bodyFile`, a batch file) pick no place ([[1013e071]]); a batch is still one project per document.
- A path outside every machine checkout sets no place: the operation follows the environment, as now.
- Doors and transport do not change: `invocation` assembles the place; doors pass only `--project`, cwd, and the entry.
- App screens do not change. The operator file operations on checkouts (`read_directory`, `write_document`, `trash_entries` and neighbors, `root` + `path`) pass the catalog check like all the rest; how the app hands them a project today, this spec did not verify.
- No storage migrations: place receipts (`recordPlace`) keep the same `Place`.

## Acceptance

The implementer proves it with three checks; the first and third fail on today's code.

1. **A catalog check** (a unit test over the assembled catalog and bodies, in `composition`). It fails naming the operation and field if: an entry field with a subject-like name (`blockId`, `blockIds`, `scopeId`, `parentId`, `rule`, `threadId`, `threads`, `rootId`, `rootIds`, `root`, `checkout`, `worktree`, `path`, `paths`, `cursor`), including nested ones, carries neither a subject kind nor a mention nor a value; a subject kind met in the catalog has no `SubjectPlaces` filler; a subject kind or `project` stands on a non-`'project'`-shape operation; `project` stands next to a mandatory subject; a `'project'`-shape operation has neither a mandatory subject nor `project`. The test holds no exception list: the operation's owner classifies an unclassified field with its schema.
2. **Declaration typecheck**: an operation without `place` does not assemble; a `'machine'`-shape operation body requiring a place service does not assemble.
3. **Integration over two projects A and B** (a thread homed in A; no `project` in the call unless stated otherwise):
   - `check_law over: 'all'` with an `inspection` and rule B's `blockId` finds a violation in B's code, like `tagma op` from B's folder (the [[7769efcd]] scenario);
   - `read_block_log` of B's block answers its history;
   - `read_owners` over an absolute path in B answers with owners from B's graph;
   - `check_law over: 'staged'` with a `root` in B judges by B's rules;
   - `check_worktree_merge` over worktree B's `rootId` answers the merge check, not `not-found`;
   - `read_thread` over a thread id homed in B answers with the thread;
   - the first writing HTTP act in B without a `project` field refuses `law-unread` with B's law, the retry executes;
   - `project: A` with B's block refuses `place-mismatch` before prepare, naming both;
   - a call with two subject fields in A and B refuses `place-mismatch`, naming both fields;
   - a call of thread A from a cwd in B over a subject in C goes to C, and with an explicit project B over a subject in C refuses `place-mismatch`;
   - `check_law({over: 'change', rules: [rule C]})` from a cwd in B with the session's lines in C judges C;
   - `read_block_log` of a block existing only in worktree B answers from that copy;
   - `check_law({over: 'change', rules: [rule B]})` with the session's lines only in worktree B judges worktree B's tree;
   - `clean_up_worktrees` with two of worktree B's roots answers one line per root, not `not-found` (whether it deletes them is decided by its own candidate selection);
   - `set_module` with B's module card writes B's map;
   - `update_block` of A's block with a `parentId` in B moves the block, as now;
   - continuing `read_gauges` with one page-B cursor answers from B; page B's `read_inspections` cursor without `project` answers from B, and with an explicit project A refuses `place-mismatch`.

The [[85742042]] inventory is the list the implementer translates. Its "recheck" lines are resolved in translation: the catalog check forces every such field to take a kind.

Coverage: interface — out (operator doors do not change); data and migrations — out (the stored `Place` is the same); performance — the "Picking the place on a call" section; refusals and agent-facing descriptions — the "What the agent sees" section.
