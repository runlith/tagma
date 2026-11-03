---
id: 01a0f483-46bd-7bbf-9507-57a43087c3ed
title: Tagma ships the `core` library of contracts and system types; domain catalogs are versioned libraries with a profile, and tag literals leave the core
ord: 5
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
Part of [[6bf40362]]. It fixes which vocabulary Tagma ships itself, what domain catalogs are, and what moves out of the core into a catalog profile.

## Outcome
- The metalanguage `#tag`, `#catalog` is the core.
- **The `core` library** ships the `core/*` contracts and the system types: `#view`, `#proposal` (installation profile defaults; a project may choose its own type with the same contract) and `#reflection`. `file_reflection` writes into the graph of Tagma's sources (`Reflection.home`, [[6b35c2af]]); the reflection type is provided there, not necessarily in every project. `code-project` no longer has `#reflection`. `#rule` ships in `core` as well, and `#task`, `#spec`, `#idea` and `#research` in the `work` catalog ([[16f1296b]]).
- **Domain catalogs** (`code-project` and future ones) are versioned libraries: types, a brief profile, defaults. The standard types are defaults, not a ban on another vocabulary.
- **A catalog profile** says how a catalog presents its types: brief sections, creation defaults, commands. Tag literals leave the core.
- Code checks switch on by an explicit measurable territory or a check profile, not because one abstract type can accept a file: `bindsCode()` (`graph/vocabulary/tagIndex.ts:72`) would turn true in a book once this library loads.

## What holds now
`#reflection` is declared in `code-project` (`catalogs/contract/wire/codeProject.ts:98`); the spec brief names `research` and `idea` as literals (`graph/orientation/briefs.ts:166,215`).

## Acceptance
- `code-project` declares no `#reflection`; `file_reflection` still lands in Tagma's graph.
- The brief is assembled from the catalog's profile; the core source names no catalog tag, held by a runlith check in `checks/` (an oxlint rule over literal positions) once the operator enforces it.
- The `core` inspection pack is gone ([[cdf2a89f]] step 6) before this library ships, so the name `core` means one thing.

## Fates
Idea [[69025288]] (a catalog declaring what a decision must answer) belongs to the profile.

## Spec-list questions
Answers 1, 3, 4, 7, 8. Owners: Tagma ships the `core` library; each domain catalog is owned by its package. Order: step 4. out: 10–17 — a catalog is installed and upgraded through [[516d96bd]]; this part adds no store or road of its own.
