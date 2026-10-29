---
id: 01a0f483-46a6-7a7d-ae96-412c3743b582
title: A tag is a type with at most one substantive parent, and one declaration compiler composes base, layer, ancestors and contracts into one schema that never weakens a gate or a lifecycle
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
Part of [[6bf40362]]. It fixes what a type is and how one resulting schema is composed from its parts.

## Outcome
- A **type** is what a thing is: fields, gates, named text sections, and **one** `extends` — a substantive parent. A new kind (`idea`, `research`, a domain module, `#bug extends #task`) is data only.
- One **declaration compiler** turns base + local layer + ancestors + contracts into the resulting schema, with the provenance of every part. There is no "first wins" or "last wins".

## Composition law
- Required gates combine by AND.
- A lifecycle is checked whole, as one state machine. A union of the allowed transitions is forbidden: it weakens the law (one machine allows `open→done`, another requires `open→review→done`). Enumerations are checked together with the transitions and terminality, not by a simple intersection.
- Open contributions (allowed edges, sources) widen only where the base contract declared the slot open.
- One single-valued state (status, holder) belongs to one binding owner; two machines over it are refused.
- Several tags on one block are kept and checked as now (`assertComposable`, [[033d8746]]): they compose or are refused.
- Several contracts on one type: the rule is in [[877ba8f0]].

## What holds now
Tags declare fields, gates, edges, sources and roles from a closed list (`graph/contract/wire/tags/declaration.ts`); there is no `extends`; several tags on one block are checked by `assertComposable` (`graph/vocabulary/declarationRules.ts:119`).

## Acceptance
- The compiler's refusals hold at write and at a candidate's switch-on: a transition union, two machines over one state, a widening of a closed slot are each refused with the part's provenance named.
- The former answers — which nodes gate, which transitions pass — are unchanged for every existing declaration after the compiler replaces today's reader.

## Performance
A cache of the resulting schema per type and revision, and a reverse index of affected descendants and carriers; a text edit triggers no pass over the corpus.

## Spec-list questions
Answers 1, 3, 4, 7 and 14 above. Owners, rejected alternatives, fates and order: [[6bf40362]] §5, §6, §8, §9 (step 1). out: 10–13, 15–17 — the compiler adds no contract, store, lifetime, rollout, failure or signal beyond those of [[42fb81f7]], [[516d96bd]] and [[fcaf4455]].
