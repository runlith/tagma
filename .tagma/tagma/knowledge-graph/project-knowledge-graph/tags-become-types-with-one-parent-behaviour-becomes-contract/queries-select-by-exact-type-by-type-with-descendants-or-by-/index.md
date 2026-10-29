---
id: 01a0f483-46b8-77f8-9b43-a7933a1439e4
title: Queries select by exact type, by type with descendants, or by supported contract; existing selectors and gates migrate as exact
ord: 4
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
Part of [[6bf40362]]. It fixes how nodes are selected once types have parents.

## Outcome
Three kinds of query: **exact type**, **type with descendants**, **supports a contract**. The core's behaviour — the doctor, `ready_tasks`, gates — addresses nodes only by "supports a contract"; "type with descendants" belongs to profiles and user queries.

## Migration
Former saved selectors and gates (`tags:`, `open-children tag: task`) migrate as **exact** — otherwise the migration would silently widen the set, for example of blocking children. An inheriting search is an explicit choice of a new query.

## Acceptance
- Every saved view and gate returns the same set after migration as before it.
- A subtype's nodes appear in a "with descendants" query and in "supports a contract", and not in an exact one.

## Spec-list questions
Answers 1, 4, 7 and 11 (saved selectors migrate as exact). Owners: the graph module. Order: step 3. out: 10, 12–17 — the query grammar grows by one kind of selector and adds no store, lifetime or failure.
