---
id: 01a0f4ab-e2ea-7966-bbfe-510a2947c38b
title: Enforcement's predicate module answers is-a-rule and is-an-open-owner over the graph's law projection, and every enforcement reader of the law roles moves onto it
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f4b9-179b-7a55-a58a-c024cd12690c",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0f476-0506-7364-9447-e291172759d0
---
Release N (order A of [[9140c692]]). Build enforcement's predicate module and move every enforcement reader of the law roles onto it ([[172759d0]] §4.2), over the graph's `TagTable.lawProjection` that the tag model's step 0 adds.

**Class:** medium — `claude-sonnet-5-5` high.

**The seam agreed with the tags lead:** the graph owns `LawProjection = { type, enabled: { field, schema }, enforcement: { field, schema }, guards, contract: 1 }` and `TagTable.lawProjection(node) / lawProjectionOf(typeId) / lawBearingTypes()`; enforcement owns `isRule(row)` (a law projection stands), `isOpenOwner(row)` (today the `work`/`decision` roles, not terminal, not superseded — `enforce.ts:104-108` moves here) and, in the adoption task, `adoptedOn(typeId)`.

**File scope:** a new `apps/tagma/server/src/enforcement/rules/predicate.ts`; `enforcement/rules/{reach,enforce,law,revision}.ts`; `enforcement/remeasure/rule.ts`. Not the graph's files (tags lead).

**Acceptance:**
- No enforcement file but `predicate.ts` calls `hasRole`, `roleTag` or `fieldName` for `law`, `enforcement`, `work` or `decision` (grep).
- A fixture project whose law-bearing tag is not named `rule` has its rules enumerated, reached and judged.
- `enforce_rule`'s owner refusals keep their meaning; enforcement unit tests pass; typecheck.

**Waits on:** the tags lead's tag-step-0 commit that adds the `TagTable` law projection.

**Reviewers:** one Muse lens (every reader moved), `gpt-6.1-sol` high general.
