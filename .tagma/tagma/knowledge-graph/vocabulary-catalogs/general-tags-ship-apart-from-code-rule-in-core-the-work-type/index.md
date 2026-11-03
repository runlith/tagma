---
id: 01a1a3c7-c256-73c2-b2a2-f29016f1296b
title: "General tags ship apart from code: #rule in core, the work types in a `work` catalog, and a catalog adds its own section to another library's type"
ord: 10
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a0e0cb-0087-794e-be47-9dc36bf40362
---
A project without code gets law and the work types without carrying code tags or code guidance: `#rule` ships in the `core` library every project installs, `#task`, `#spec`, `#idea` and `#research` in a `work` catalog, and `software-development` keeps `#module` and `#explanation`, builds on `work` and adds its code words to `#rule` and `#task` as sections of its own. A concept every domain shares is one type; a catalog never adds fields or roles to another library's type, so a block moved to a project without that catalog stays valid.

## The model

- **One thing, one type.** A shared concept has one declaration in one library. Another catalog adds to it only a section of text, keyed by that catalog's id, closed to project edits. A different thing is a new type, a subtype where it is one.
- **Composed text.** The text an agent reads is the type's own sections, then the section of each installed catalog adding to it in registry order, then the type's `project` section. A catalog section stands while its catalog is installed and changes when that catalog's release does.
- **A project disagreeing** appends to the `project` section or forks the type, settled by `graph/vocabulary/layers.ts` over the composed text exactly as over a single library's text today.
- **The catalog is the unit of choice.** Types of one catalog reference each other (`#spec`'s open-children gate names `#task`), so no single type is picked out of a catalog; catalogs are cut small instead.

## Mechanism

- `Catalog` (`graph/contract/wire/tags/declaration.ts`) gains `requires` — the catalogs installed with it — and `sections` — `{ type, text }` with `type` the permanent id of another library's export. Neither is stored per project: both are shipped TypeScript, carried by the release revision.
- The installer (`graph/vocabulary/candidate.ts`) closes the wanted set over `requires` — `core` first, a required catalog before the one needing it — and composes every wanted catalog before settling it: the composed type is the shipped type that layers and forks settle over, the type the release records as base, and the catalog the release revision digests. So a contributed section arriving, changing or leaving reads as a shipped change to the receiving library, `current()` sees it, and a project append stays a layer over it.
- Catalog membership is unchanged: a catalog stays installed while its `#catalog` node stands, whether or not `graph.catalogs` still names it. A section leaves at the installation after its catalog's node is deleted, which every graph opening and server start runs.
- `layerWrite.checkedText` compares a rewritten `#tag` body with the composed shipped type of the project's installed catalogs, so an appended part becomes a `project` layer over the composed text.
- `tagsOfCatalogs` returns composed tags over the requires closure, so the shipped vocabulary reads what an installation writes.
- `graph.catalogs` keeps its values; its fallback for new projects is `core`, `work`, `software-development` — a new project reads exactly what one reads today. `brand`-like projects on `["core"]` gain `#rule`.

## Placement and texts

- `core`: `#reflection`, `#view`, `#rule` — same name, fields (`enabled`, `delivery`, `enforcement`), roles and contracts. `#rule`'s text is the law alone: what a rule is, how it is written, the three deliveries in words that hold for any files, and one sentence that a measurable rule is enforced by a check `tagma.config.ts` declares, through enforce_rule. Delivery keeps the word `code`: it names delivery on reading or writing the files a rule's sources name, which holds in a notes repository too.
- `work`: `#spec`, `#task`, `#idea`, `#research`, with today's fields, edges, gates, roles and the research batch profile; texts without code words (`#task` finishes "once the work happened", `#research` names "what was read and where").
- `software-development`: `#module`, `#explanation`, `requires: [work]`, profile `checks.code`; sections on `#rule` (sourcing and choosing `finding` for code norms, offering a check for a code norm) and on `#task` (finished with the commit carrying the work) and `#research` (a reading of code names the checkout or version).
- The detail of checks, debt, escapes and enforce_rule lives in the `rules` skill; what the cut `#rule` text carried and the skill lacked moves there.

## Existing graphs: the step `20261104000000_work_catalog`

Every graph holding `software-development` exports `rule`, `task`, `spec`, `idea`, `research` is re-pointed once, before installation, the way `software-development-names` moved `#reflection` and `#view` to `core`:
- declarations of those exports take `identity.shipped` `core/rule` and `work/<export>`; every stored permanent id and field id (`shipped:software-development/task#status`), in any block's tags or fields — saved queries, profiles, layers, forks, extends, ref fields — and in `block_tag.type_id`, is re-pointed;
- their names leave the `software-development` catalog's members and their bases leave its release; `#rule`'s join `core`'s, the work types' join a `work` `#catalog` node the step creates with an empty guidance base, so the installer finds each copy's base, takes an unchanged copy to the new text, keeps an appended part as its layer, and keeps a rewritten copy with a migration-conflict finding as today.
Statuses, holders, enforcement documents, debt, escapes, edges and history stay on the blocks untouched: the law projection is keyed by the type key `rule`, debt by the rule block, and work and law are found by contract, never by library.

## Owners

Catalogs module ([[71f4b029]]) owns the catalog declarations, `requires`, `sections` and the default set. Graph vocabulary owns composition, the installer and the step. Enforcement and work are untouched: they find rules and debt owners by contract.

## Rejected

- **Composing at compile time** instead of installation: the `#tag` node's body would differ from the text agents read, and a fork would keep receiving another catalog's section it meant to replace.
- **An installer record of where a type moved from**: permanent code for a one-time move; a graph step is the road for stored-shape changes.
- **Copies of the work types in a codeless catalog**: two types for one concept, and a block moved between projects would change type.
- **Renaming delivery `code`**: it is a stored value with refusals and operations naming it, and its meaning — files the sources name — already holds without code.

## Acceptance

- A project with only `core` has `#rule` with no code wording; its prompt rules reach agents' instructions.
- A project with `work` and no `software-development` has the work types with no code wording and no `#module`, `#explanation` or code checks.
- A project with `software-development` reads `#task` and `#research` as their `work` text plus the `software-development` section, `#rule` as the law plus its code section; `software-development` alone installs `work`.
- A catalog section shows only while its catalog is installed; a project's append to `#rule` stays a `project` layer after the composed text; a fork stays a fork.
- After the step and installation, existing rules, tasks, specs, ideas and research keep statuses, holders, enforcement and debt, saved queries select the same blocks, the installer raises no finding, and the step is idempotent.
