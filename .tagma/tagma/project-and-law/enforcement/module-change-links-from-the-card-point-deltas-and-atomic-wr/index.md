---
id: 01a11d5c-f6ad-71c1-89fb-c64e401d202c
title: "Module change: links from the card, point deltas and atomic write with a compact answer"
ord: 23
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a0fd8b-bef1-758e-b119-40b1d962023e
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/enforcement/modules.itest.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/contract/wire/modules.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/rules/moduleChange.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/rules/moduleFaults.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/rules/moduleRefs.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/rules/modules.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/voice.ts
  - kind: file
    ref: apps/tagma/server/src/graph/blocks/modules.ts
  - kind: file
    ref: apps/tagma/server/src/graph/contract/wire/modules.ts
  - kind: symbol
    ref: apps/tagma/server/src/enforcement/operationBodies.ts
    symbol: modulesExecuting
---
Changing a module boundary must express only the caller's intent: add an entry, drop a link or replace a set wholesale. Values shown by the card are accepted by the write with no manual identifier translation; a refusal names every independent request error and the concrete fix. This extends the existing `set_module`, with no new write operation, no shared patch language and no extra confirmations.

Ground: the incident in the [[01a11ca6-108b-7a87-871b-c8bf50fb5af4|transport implementation thread]]: the card issued `for` by block names, the write demanded module ids; adding several entries required resending the whole set and touched stale paths. Three consecutive refusals of the last series took about 3 minutes 40 seconds to a successful write. The JSON of a successful answer was 140,526 bytes from an inner `stood`; the card text also didn't show `for` and `role`. These numbers belong to that incident, not to product performance in general.

## Addressing and owners

[[7abcb9a1|Enforcement]] owns the change intent, entry resolution, working-tree checks, final map assembly and rule measurement. The [[d962023e|graph]] owns cards, their stable identity, edges, sources and atomic write. Storage stays as before: `for` holds links to cards, imports are edges. Renaming a module id doesn't rewrite incoming links.

`entries[].for`, `imports` and `importsTests` share one module-link scheme: a string, `{ id: string }` or `{ block: blockRef }`. For a string the resolver tries the exact module id and the plain block name: a single found module is accepted; two matches on one card are accepted too; different cards give a refusal with candidates. A non-module block is no candidate. The object form picks the namespace explicitly on collision: an existing candidate in a refusal is shown as `{ block: <full name> }`, one born in this call as `{ id: ... }`, since the card has no name yet. No priority by string spelling is introduced. Forbidding hex-like module ids and renaming existing data for the resolver isn't required. Block-name resolution uses the existing graph resolution, including ambiguous abbreviations and the project boundary.

Top-level `id`, `block`, `parent` keep their separate roles: `id` is the module key, `block` explicitly addresses the renamed card, `parent` its parent. First all call modules' identities are collected, then links resolve against the final state: births are visible by new ids regardless of array order, a renamed module — by new id or card name. The old id and a link to a deleted module refuse, explaining the change in the same call.

Resolution happens once in prepare. The prepared write hands the graph already-resolved links: existing row ids and birth-local handles. The graph writer matches handles to inserted rows and stores links; it doesn't re-parse module ids. The shared prepared-write type stays in the lower graph contract. No new service or registry is needed for this.

## Point changes to collections

Fields get one explicit change grammar:

- `entries: { put?: Entry[], drop?: string[] }` or `entries: { replace: Entry[] }`. `Entry` carries `at`, optional `for` and `role`; the key is `at` relative to the root. `put` replaces the entry wholesale: a missing `for` opens it to all lawful importers, a missing `role` removes the special role. Other entries stay.
- `cuts`, `imports`, `importsTests`: `{ put?: T[], drop?: T[] }` or `{ replace: T[] }`. These are sets; for relations the key is resolved after link resolution to the card. An already-standing value isn't duplicated on `put`.
- A missing field doesn't change. `replace` is incompatible with `put`/`drop`; one key can't stand in both sides or repeat inside one side. `drop` of a missing key refuses: a typo must not pass as an executed delete.
- `entries: { replace: [] }` closes the module surface and removes the entries field on the card; no `null` is needed for entries. `order` stays a whole list or `null`: floors have order and get no positional patches.

Bare arrays of these four collections are replaced by the new shape in all current callers, schemas and descriptions in the same delivery. Stored documents don't change. Full replacement is an explicitly chosen act, and an ordinary add no longer carries previously read values from elsewhere back into the graph.

For example, adding an entry only needs `set_module({ modules: [{ id: "@runlith/agent", entries: { put: [{ at: "src/thread/transport/contract.ts", for: ["threads", "native-harness"] }] } }] })`. `for` values from `read_block` can be passed into the same `put` unconverted.

## Check and write

The delta applies to the card state read in prepare. All `put` and `replace` paths, the root, new cuts and an explicitly given order are checked. An entry unchanged by a delta isn't re-checked for file existence. On root change all entries and order remaining under it are checked. `drop` doesn't require the deleted path to still exist on disk. A missing file and a filesystem read error are different results; a read failure doesn't turn into "no path".

All independent link-resolution, repeat and path errors of one request are collected into one refusal before measurement. Each names the module, field, original value and the fix needed; a dependent check with an unresolved root or module doesn't invent further fictitious errors. The existing `code`, `reason`, `unblock` shape stays. An ordinary refusal doesn't send the reader through the whole map: it addresses a concrete card or one request field.

The final map of the whole call is checked, not an intermediate state of single modules. Deleting a module that stays in someone else's `for` refuses with "module, entry" pairs; this call can fix them. A name must not be dropped from `for` automatically: an empty list must not turn into access for everyone. Deleting incoming imports keeps the existing edge-delete semantics. The live-children check of a deleted card stays in the write act.

Measurement runs once over the final map; an unchanged map doesn't start a remeasure. Cards and rule debt write atomically. Comparing the prepare-time state with the current card and active map rules must run in the same transaction as the write: a change between check and write can't be accepted on an old measurement. `applyModules` wraps the `standingOf(moduleCards, mapRules)` check and `writeModules` in the existing outer `Act.unit`; nested write units of enforcement and modules become savepoints of the same transaction. The graph learns no `takesMap`, and the user gets no extra token, lock, lease or confirmation step. On a real change the answer is `enforcement-stale`; a retried delta prepares against the new card and keeps a teammate's independent change. The git check via `staleUnder` stays before the unit so git I/O doesn't hold the writer; the existing window of an outer HEAD change after that check isn't widened or declared closed here.

Whole-map checking stays simple: a point edit may link to any other module even without enforced rules. Splitting freshness into touched-card sets, cache and an incremental dependency graph is out of scope. Local id and card indexes are built once per prepare; the repeated linear scan over all cards per link goes away.

## Read and result

`read_block` stays the edit read of one card: it already shows entries with `for`/`role`, sources and relations, and the write now accepts those links. No separate `read_modules` is introduced. `read_inspections(map: true)` stays the whole-map diagnostic; its text keeps `for` and `role`, not just the path. It is no longer needed to recover from an ordinary card-change error.

The `set_module` answer is assembled explicitly on the public schema: changed modules (`id`, `card`, `act`), measurement results and the graph-copy address. `debt.before` and `debt.after` in a measurement result are counts; `absorbed`, `retired`, `escaped` keep the real change. Inner `stood`, prepared writes and full map snapshots never go outside. With an unchanged set of touched modules and measurement results the answer size doesn't grow when unrelated cards are added to the project. Voice, JSON and confirmation use one public projection.

## Build order and acceptance

One connected delivery, three stages: (1) link schema and resolved prepared write, collection schemas and all their consumers; (2) delta application, full refusal and transactional freshness check; (3) public answer, card text, tool descriptions and result checks. Code points: `enforcement/contract/wire/modules.ts`, `rules/modules.ts`, `operationBodies.ts`, `voice.ts`, `graph/contract/wire/modules.ts`, `graph/blocks/modules.ts`; extending the existing owner tests in `composition/testing/enforcement/modules.itest.ts`.

The implementer proves through public operations and graph state:

1. A card reads and its links round-trip back together with one new entry; a module can be born and linked in one call, renamed without losing incoming links. A namespace collision doesn't pick a random owner.
2. Adding several entries next to an untouched missing path passes; an explicit `put`/`replace` with a missing path and a root move under incompatible entries refuse. A missing file's entry can be deleted.
3. Several independent bad links and paths return as one refusal; neither card nor debt changes halfway. A deleted module doesn't silently disappear from someone else's `for`.
4. A map or map-rule change between prepare and write gives `enforcement-stale`; after re-preparing both independent deltas are kept. The check uses the real public prepare/execute cycle and transaction, no timers and no special test hooks.
5. The real serialized boundary returns only the declared answer and that operation's results; adding unrelated cards doesn't inflate it. This checks the outer contract, not an inner object snapshot.

Typecheck confirms the single input/output shape at current consumers. Tests don't pin hint words, prompt or layout; minimal fixtures in the existing integration layer and its budget are used. The operator may separately check live module-change usability; their check doesn't hold up the implementer's completion.

## Boundaries

Out of scope: shared control of model-generated tool arguments; applying the answer schema to all operations; a new UI form for the module editor; inspection-tree machinery for generated files; a full rework of enforcement reads. The known separate [[f564b376|SvelteKit measurement failure]] and [[3dd75106|card-deletion incident]] aren't declared fixed by this spec. The [[83c2055b|architecture-debt triage idea]] stands on its own: the module workflow change doesn't decide who takes apart the debt and when.
