---
id: 01a0f483-46d2-76de-8852-1252b4f28f40
title: Type ids enter storage in a separate bounded stage after the resolver stands, preserving every node, history row and verdict
ord: 8
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
Part of [[6bf40362]]. It is the separate, bounded stage that puts type ids into storage once the resolver of [[42fb81f7]] stands.

## Outcome
- `block_tag` gets the type id; the physical migration of storage runs as its own stage, not with the first.
- Nodes and their data, history and verdicts are preserved; until this stage, everything goes through the resolver.

## Why separate
Draft v1 said both "storage is not rewritten" and "`block_tag` gets the type id"; the review (arch-opus) asked to choose one. v2 keeps both as two stages: the resolver first, the column later, so the first stage changes no stored byte.

## Enforcement documents
The stage never rewrites a rule's enforcement document; a document changes form only at its rule's next `enforce_rule`. Enforcement's adoption digest is over the decoded policy and the reach identity, never file bytes or field key names ([[172759d0]] §4.1), so re-keying fields by id turns no adopted rule pending.

## Acceptance
- After the stage, every carrier resolves to the same type it resolved to through the resolver before it; no node, history row or verdict is lost.

## Spec-list questions
Answers 1, 4, 7 and 11 (a migration of `block_tag`; rollback is [[516d96bd]]' checked reverse migration). Owners: the graph module. Order: after step 2 of [[6bf40362]]. out: 10, 12–17 — its contract is [[42fb81f7]]'s; rollout and failures follow the store migration rules of [[70083b67]].
