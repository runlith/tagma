---
id: 01a0f483-46b0-7202-b8fc-bbf742fb81f7
title: Types and fields carry permanent ids and names are aliases, so a tag with carriers can be renamed and two catalogs sharing a name coexist; the first stage rewrites no storage
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
Part of [[6bf40362]]. It fixes how types and fields are identified and referenced.

## Outcome
- A type and a field have **permanent logical ids**. A shipped one has a provenance — library + export + version; a local one has the id of its declaration.
- A name is an alias within the project; a name conflict between two catalogs is resolved by an alias at installation.
- References — `extends`, the targets of reference fields, saved queries — store ids, not names.

## Problem
Renaming a tag that has carriers is refused (`graph/blocks/update.ts:59-87`, `carriers-invalid`); two catalogs using one tag name collide.

## Target, first stage
Storage is not rewritten: `block.tags`, `block_tag` and fields keep their keys by name. A resolver links each former key to its permanent id, and the former key becomes an immutable compatibility key. The id column and the physical migration are [[b4f28f40]].

## Acceptance
- A tag with carriers is renamed without rewriting its carriers.
- Two installed catalogs declaring one tag name coexist under an alias.
- A saved query and an `extends` survive a rename.

## Spec-list questions
Answers 1–4, 7, 10 (ids and aliases in the declaration) and 11 (storage untouched in this stage; the resolver maps old keys). Owners: the graph module ([[6bf40362]] §5). Order: step 1. out: 12–17 — no permission, lifetime, bound, rollout, failure or signal of its own; rollout is [[fcaf4455]]'s.
