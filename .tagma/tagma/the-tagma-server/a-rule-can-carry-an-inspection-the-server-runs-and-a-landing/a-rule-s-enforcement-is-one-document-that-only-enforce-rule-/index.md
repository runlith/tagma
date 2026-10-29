---
id: 01a0d4db-9d6b-7d1a-8ba6-f4b164798cd8
title: A rule's enforcement is one document that only `enforce_rule` tightens, loosens or indebts, and no other road lifts while it gates
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/catalogs/contract/wire/softwareDevelopment.ts
  - kind: file
    ref: apps/tagma/server/src/graph/contract/wire/tags/declaration.ts
---
A rule's enforcement is one document on the rule. Two things write it: the operation `enforce_rule`, which is the only way to tighten it, loosen it or add debt, and the re-measure driver, which may only shrink the debt and record escapes. While a rule stands at watch or gate, no other road can lift it.

## The document

`protocol/tags/shape.ts` gains:
- the role `enforcement`, which binds a field name like `law` does and joins `OWNED_ROLES`;
- the field schema `lawEnforcement`, decoded in `graph/core/Tags.ts`.

```
{
  version: 1,
  strictness: 'note' | 'watch' | 'gate',
  at: 'landing' | 'merge',
  inspection: { builtin: <id>, params: <that builtin's schema> },
  debt: { fingerprint, owner, value? }[],
  escaped: { fingerprint, path, line, commit, holder? }[],
  baseline: { commit },
  measured: { ms, at }
}
```

- The builtin ids and their parameter schemas live in `@tagma/inspection`'s vocabulary door ([[ae56a980]]), which `protocol/` reads. So both `protocol/` and `graph/` decode the document without importing `enforcement/`. The package holds one implementation per id, in a `Record` over the same id union, so the compiler checks that every id has one.
- `owner` is required on every debt entry. It is the name of a standing task or decision that removes the entry. `enforce_rule` resolves every owner and refuses a name that answers no such block.
- `at: 'landing'` rules also run at a merge, because a branch cut before the rule was enforced lands through the merge. `at: 'merge'` rules run only there.
- `measured` is the last measured duration of the inspection over the rule's reach. The landing budget is summed from it.
- **Additive growth.** [[50467aad]] adds the `command` variant of `inspection`, and a later slice adds `work` to `at` for test layers. Both are additive under `version: 1`. This slice ships only `builtin`, `landing` and `merge`, with no branch for a variant it does not run.
- The document stays on the rule at `note`: it is delivered, it runs nowhere, and it keeps its debt. So returning to gate is a re-enforcement, never a fresh baseline.

## Catalog

- **Declaration.** `code-project`'s `#rule` declares `enforcement: { type: 'schema', name: 'lawEnforcement' }` and the role `enforcement: 'enforcement'`. The declaration gate requires `enforcement` and `law` on the same tag, so an enforced rule is always delivered.
- **Guidance.** The release rewrites the catalog guidance and the `#rule` prompt so they agree with the mechanism: debt is a standing violation with the work that removes it, not an exception, and a rule's strictness moves only through `enforce_rule`.
- **Other projects.** Another project's vocabulary may bind the role on another tag, or not at all. The core reads only the role.

## Only operations write it, and nothing lifts it quietly

- **Hand writes.** `graph/core/Blocks.ts#assertNotOperated` refuses a hand write of the field bound to `enforcement`, at birth and by update, with `operation-only`, naming `enforce_rule`.
- **Other roads that would lift a gate.** While the strictness is watch or gate, these refuse `rule-enforced`:
  - switching the rule off (`update_block` `enabled: false`, `Blocks.setEnabled`, `tagma disable`);
  - superseding it, trashing it;
  - moving it to a parent whose reach differs.

  The `unblock` names `enforce_rule` to `note` first.
- **Limitation — the `.tagma` tree road** absorbs what a commit carries, a changed document included. It is not gated in this slice. A crossing that lands under a document edited that way is caught by the driver as an escape.

## `enforce_rule`

Input:

```
{ blockId, strictness: 'off' | 'note' | 'watch' | 'gate', at?, inspection?, owners?: Record<fingerprint, name>, absorb?: fingerprint[] }
```

`prepare` measures and `execute` writes, following [[1e4a8f0d]]:
- **`prepare`** runs the inspection over the rule's reach at the HEAD of the checkout the graph measures. The reach is the rule's containing region intersected with `params.base`; a rule under the project root reaches the whole project. The run goes on the whole-reach worker, and `prepare` computes the debt, the escapes and the duration.
- **The confirmation** names the rule, the strictness, the run point, the debt with its owners, the escapes absorbed, and the duration against the landing budget.
- **`execute`** writes exactly what was confirmed, and refuses when HEAD moved since `prepare`.

Cases:
1. **First enforcement** (no document stands). `inspection` is required. Every fingerprint found becomes debt, and `owners` must name an owner for each one. `baseline.commit` is HEAD.
2. **Re-enforcement** (a document stands, at any strictness):
   - debt keeps the entries still found;
   - fingerprints found and not in debt are escapes, and they refuse `debt-grows`, each named, unless listed in `absorb` with an owner in `owners`;
   - a changed `inspection` is re-measured the same way.
3. **Landing budget.** `at: 'landing'` at watch or gate refuses `landing-budget` when the rules standing at landing, with this one's measured duration, would exceed the project's landing budget. The `unblock` names `at: 'merge'` or `watch`. A `global` builtin at landing refuses the same way.
4. **`off`** removes the document. The journal keeps the whole document it removed. A later enforcement is a first enforcement again, and every debt entry needs an owner again.

**Loosening is its own permission subject**, so a thread's mode can require the operator's word for it. Loosening means: lower strictness, `off`, narrower `params`, or `absorb`.

The answer and the journal entry both name the strictness, the run point, the inspection, the debt before and after, what was absorbed, and the duration.

`enforce_rule` enforces project rules only. A cross-project rule in the global graph measures no one project's paths: out of this slice.

## Reads for the agent that sets rules up

Rules are set up by an agent, never written by hand, so everything that agent needs is read from the running server.

- `read_inspections` answers a page of rows with the total ([[68659e3b]]). Each row is a builtin: its id, reach, parameter schema, fingerprint unit and stated limitations. It also answers the project's landing and merge budgets.
- `try_inspection { blockId?, inspection, limit?, cursor? }` runs an inspection over a reach at HEAD and answers a page of violations with the total, `unjudged` and the duration. It writes nothing and runs on the whole-reach worker.

## Delivery

The unit a thread receives for a rule carries the rule's enforcement line: strictness, run point and the builtin's own rendering of its parameters (for `direction`: the floor table). The line is part of the rule's revision, so changing the strictness or the floors reaches every thread ([[d96eee44]] is rewritten to say so). A region's rule arrives after the session's first touch of the region ([[6b608d5d]]), so the verdict before landing is `inspect_work`.

## Acceptance

- `update_block` or `create_block` writing the field refuses `operation-only`.
- `enabled: false`, supersede, trash or a reach-changing move of a rule at gate refuses `rule-enforced`. At `note` each succeeds.
- A first `enforce_rule` at gate with `direction`:
  - without an owner for each found crossing, refuses;
  - with owners, writes the document, with debt equal to the crossings at HEAD.
- `note` then `gate` with a new crossing in HEAD refuses `debt-grows`. With `absorb` and an owner it records the entry, and the journal names it.
- A HEAD that moves between `prepare` and `execute` refuses the write.
- A rule at landing whose measured duration exceeds the landing budget refuses `landing-budget`.
- `read_inspections` answers `direction` with its schema. `try_inspection` answers what the first enforcement would record, and leaves graph and journal untouched.
- A thread's instructions show the enforcement line, and changing the floors changes the rule's revision.

## Spec-list questions

This decision answers:
- 4: the document;
- 7: acceptance;
- 10: the document version;
- 11: data, which lives in a field;
- 12: loosening as a permission subject;
- 16: concurrency — `prepare` measures, `execute` writes.

The rest are answered in [[be584b76]].
