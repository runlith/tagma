---
id: 01a0f4aa-02c3-7b01-b494-5e38f1c49a55
title: "Tag step 0: vocabulary format marker with old-writer refusal, VocabularyRevision, LawProjection on TagTable and the AdoptedLaw port (release N)"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f4aa-7bd1-7b96-a4ab-6c853924d378",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0f483-46cc-7e9a-97aa-8b51fcaf4455
---
Step 0 of [[6bf40362]] and the graph half of the seams agreed with the law layer ([[9140c692]]); part of release N, which writes no new form. Class: **complex** (claude-opus-5-5 `high`).

## Do
1. **Format marker and old-writer refusal** ([[fcaf4455]]): `vocabulary_format = 1` in the graph store's `meta` table and in the tree descriptor `.tagma/<project>/format.json` (`{graph, vocabulary}`, written and committed with the tree). A server opening a store, or reading a tree, whose vocabulary format is newer than it understands serves reads and refuses every write and every catalog install, typed, naming both formats — checked at store open and in freshness before any import. This is the subset of [[70083b67]] D1 needed now; D1's `graph_stamp` later carries the same values and changes no reader.
2. **`VocabularyRevision`** in `graph/contract/wire/tags/revision.ts`: `{ format: number; revision: string }`, `revision` = sha256 over the project's effective declarations in canonical JSON sorted by type id; `TagTable.revision()` computed once per table build, no I/O.
3. **`LawProjection`** in `graph/contract/wire/tags/law.ts`: `{ type: string; enabled: { field: string; schema: string }; enforcement: { field: string; schema: string }; guards: readonly string[]; contract: 1 }` — `schema` is the field's codec id (today `lawEnforcement` for the document, the switch's own schema for `enabled`), `guards` the lifecycle guards protecting an adopted rule (today `rule-enforced` over disable, supersede, trash, move). `TagTable` gains `lawProjection(node)`, `lawProjectionOf(typeId)`, `lawBearingTypes()` — computed today from the `law` and `enforcement` roles; [[877ba8f0]] later swaps the implementation to contracts.
4. **Graph's own law readers move onto `lawProjection`**: `graph/blocks/law.ts` (switch, guards), `graph/orientation/law.ts` (delivery), `graph/vocabulary/declarationRules.ts:394`, and any other graph reader of the `law`/`enforcement` roles. Enforcement's readers are the law side's (its predicate module) — do not touch `enforcement/` or `graph/contract/wire/enforcement.ts`.
5. **The `AdoptedLaw` port** in `graph/contract/service/adoptedLaw.ts` (rule [[e090f46d]]): `on(typeIds) → Effect<{ revision: string; adopted: readonly { rule: string; type: string; projection: LawProjection; vocabulary: VocabularyRevision; revision: string }[] }>`. Declaration only; enforcement fills it; nothing calls it until [[516d96bd]].

## Order inside the task
Land the `TagTable` API (items 2 and 3, with a trivial port declaration of item 5) as its **own commit first** and report it to the tags lead at once — the law side's predicate module waits on it. Then items 1 and 4.

## Scope
`graph/contract/wire/tags/`, `graph/contract/service/adoptedLaw.ts`, `graph/vocabulary/`, `graph/serving/{open,freshness}.ts` and what the refusal needs in `graph/serving/`, `graph/blocks/law.ts`, `graph/orientation/law.ts`, and their tests. Out of scope: `enforcement/`, `graph/contract/wire/enforcement.ts`, anything writing a new declaration form.

## Acceptance
- A store or tree carrying a newer `vocabulary_format` refuses writes and catalog installs on this server, naming both formats; reads are served (an integration test through the public operations).
- `TagTable.revision()` is stable for an unchanged vocabulary and changes when a declaration changes; `lawProjection` answers the same set of law-bearing nodes the `law` role answers today (runlith's `#rule`).
- Delivery and the `rule-enforced` guards behave as before (existing tests stay green).
- Typecheck and the unit and integration tests of the touched modules pass; the commit inspections pass. No restart (rule [[8162ede6]]).
- Afterwards: claims written from the code for what landed, [[fcaf4455]] closed into them only when release N has shipped.
