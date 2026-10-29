---
id: 01a1471d-2887-752b-b63b-e98f48a7aa11
title: "Rule delivery is explicit: the delivery field — prompt or code — and sources decide which code; the place in the tree does not decide reach"
ord: 64
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/orientation/Instructions.ts
  - kind: file
    ref: apps/tagma/server/src/graph/orientation/law.ts
  - kind: file
    ref: apps/tagma/server/src/graph/orientation/reach.ts
  - kind: file
    ref: apps/tagma/server/src/graph/orientation/touches.ts
  - kind: symbol
    ref: apps/tagma/server/src/catalogs/contract/wire/softwareDevelopment.ts
    symbol: rule
---
A rule carries an explicit `delivery` field, and only it together with its sources decides where the rule reaches an agent. The rule's place in the tree no longer decides anything.

## Why

Measured in gf-tagma (project 37): #rule 34e7d61d with sources `dir apps/api/src/app/activities`, `dir apps/api/src/app/import`, `symbol libs/common/src/lib/helper.ts#parseActivityDate` stood under the project root and therefore rode every thread's startup instructions marked `[3cc4d24c gf-tagma]` — "the whole project". Yet the #rule declaration said "a rule binds the code of its sources, otherwise the nearest module's territory above". The real reach added up from three implicit things — sources, the module above in the tree, and the rule family's container — and the user could not tell what the agent would get.

## What the user gets

- Each rule shows and changes one value: `prompt` or `code`.
  - `prompt` — the rule stands in every thread's startup instructions of the project, in full, marked `[prompt · <project>]`.
  - `code` — the rule arrives only when the agent reads, searches, or writes the code its sources name (dir — everything under it; file — that file; symbol — the file where it is declared, as `#note` explanations match), marked `[code · <sources>]`.
- Until the field is set the value is derived: a rule without sources is `prompt`, one with sources is `code`. A set field overrides the derivation both ways: a rule with sources can be placed in prompt.
- Sources and `delivery` are independent. Switching `delivery` (in UI or by an agent) never touches sources: in `prompt` the sources stay attached but do not decide delivery; back in `code` they act again.
- In the app: in the rule block's menu — a "Delivery" submenu with three items: "By sources" (field unset), "Prompt", "Code"; the current one is marked. On the rule page — a "Delivery" row with the effective value and what it means: "prompt · every thread of runlith" or "code · apps/…, …"; an explicit value is marked, a derived one — "by sources".
- An agent writing a rule picks `delivery` itself from the #rule declaration text: a norm for the whole project or wider than the code it was born in is `prompt`; a norm about specific code is `code` with sources naming that code.

## Behaviour

1. **Startup instructions** (`Orientation.instructions`): global rules (by the `rules.global.*` settings, as today) + all enabled, unreplaced project rules with effective `prompt` delivery, wherever they stand in the tree. No `code` rules. The set is exactly the current prompt rules: a rule switched to `code` leaves the set as a `Withdrawn` row; one switched to `prompt` enters it. The thread's "targeted scope" (`LawReach.scope`) and carrying already-issued law (`carried`) are removed: the tree place no longer decides reach, and the set always equals the prompt rules.
2. **Code touch** (`Touches.touch`): only `code` rules whose sources cover the place. A prompt rule is not repeated on touch — it is already in the instructions; so the "rules here" mark for carried rules (`carriedLaw`) is removed. Row: `rule here — <name> <title> [code · <sources>]: <body>`.
3. **Briefs**: a work brief — global prompt + project prompt + `code` rules whose places intersect the task's sources (either way: a rule above or below the task's place). A spec brief — the same by the scope's own sources. The task's or scope's place in the rule tree adds nothing.
4. **Global graph**: its `prompt` rules ride every project's prompt marked `[prompt · global]`. Global has no code, so its `code` rule reaches no project; the UI shows it as `code · no sources`. The field is one and means the same everywhere.
5. **The mark** names the effective reach: `[prompt · runlith]`, `[prompt · global]`, `[code · apps/api/src/app/activities, apps/api/src/app/import, libs/common/src/lib/helper.ts#parseActivityDate]` — the first three sources, then `, …`. `code` without sources is `[code · no sources]`: such a rule reaches nowhere.
6. **Enforcement**: a running enforced rule's scope is its sources' places (dir — the subtree, file and symbol — the file), without sources — the whole project; `delivery` does not affect it (a rule in prompt still measures its sources). It is the same place function as for delivery — one owner. What the existing enforced rules measure does not change: rules whose scope came from a module above get explicit sources through the migration below, and none of runlith's 17 enforced rules carries a symbol source (read 2026-10-17) — the only thing that could shift their scope. The stale-preparation sign of `enforce_law` changes from "the rule moved under another parent" to "the rule's sources changed": the parent no longer decides scope.
7. `set_module` no longer recomputes rule reach from maps: rule reach does not depend on maps.

## Owners and architecture

- **Vocabulary** (`graph/contract/wire/tags`): a new `delivery` role in `ROLES`/`roleBindings`; core/law (`enforcement/contract/service/lawBehaviours.ts`) gets an optional `delivery` slot (kind enum) and a `set_law_delivery` action. `LawProjection` carries `delivery: LawField | null`; `deliveryOf(projection, node, sourced)` in `tags/law.ts` is the single derivation place: "set → value, else sources → code, none → prompt". The app reads it too. `incoherence` requires the delivery role to come with law and point at an enum of exactly `prompt` and `code`. The field is not owned: an agent sets it at create/update, `set_law_delivery` is the UI road, including unsetting (null).
- **code-project catalog** (`catalogs/contract/wire/codeProject.ts`): `#rule` gets `delivery: {type: 'enum', values: ['prompt', 'code']}` and `roles.delivery`; the prompt declaration explains the field and the choice; the catalog guidance stops speaking about module territory. Installed copies get an automatic catalog upgrade; where the catalog guidance is locally edited (runlith), it is edited in the graph by hand in the same change.
- **Reach** (`graph/orientation/reach.ts`, the fact owner): `ruleReach(projectId)` answers `{ delivery, sources, places }` per rule: `sources` — names for the mark (`ref` or `ref#symbol`), `places` — the sources' places or `['']` (whole project) without them. Module territory and `moduleAbove` leave from here. `Orientation.ruleReach` serves this map; enforcement takes `places`.
- **Law** (`graph/orientation/law.ts`): `promptLaw(projectId)` — families of prompt rules only; `globalLaw` filters global-graph prompt rules; `rulesBinding(projectId, places)` — prompt + code by place intersection. `containerId`, `reachOf`, `containerAncestry`, `chainAbove` for law are removed.
- **Instructions** (`Instructions.ts`), **touches** (`touches.ts`), **briefs** (`briefs.ts`), **sessionStart** — read this, hold no reach derivation of their own.
- **Blocks** (`graph/blocks/law.ts`): `setDelivery({ id, delivery: 'prompt' | 'code' | null })` next to `setEnabled`; the `set_law_delivery` operation (`graph/operations/outline.ts` + wire).
- **Enforcement**: `EnforcementWrite.parentId` → `anchors` (sorted `kind:ref#symbol` rules at prepare time); `setEnforcement` refuses with `enforcement-stale` when sources changed. `modules.ts` loses `reachOver`, `enforce.ts` — `ask.reach`.
- **Native/external harnesses**: `instructionRule` stops passing scope; `touchRule` and `external-harnesses/guidance.ts` stop counting `carriedLaw`; `instructionLaw` is removed.
- **Texts**: the #rule declaration and the catalog guidance; doctrine (`graphEvidence.ts`: "Law binds where it is delivered…", `graphWriting.ts`: "A parent decides reach…"); the `Instructions.ts` and `sessionStart.ts` rows about "region"; the installed #rule aa607f67 and the a80f00f4 catalog in the runlith graph. The closed spec 19851665 stays history.

## Migration

The `rule-delivery` graph step after `core-names` (rule acb620dd: one current form). For every live project rule (including disabled and replaced ones) with no `dir`/`file` source and a module above in the tree, it attaches as `dir`/`file` sources that module's territory — the module's own roots and cuts and all nested modules', as the old `ruleReach` computed, minus places nested inside another place of the same set. So such rules' `code` delivery and enforcement scope stay exactly as before. A rule with only symbol sources under a module also gets the territory: before, its symbol reach decided nothing. Such a rule's symbol source outside the module territory now also delivers the rule — when its file is read: a source means what it says, not what was once unread. No enforced rule in runlith has symbol sources, so the enforcement scope does not shift from this. An enforced rule outside a module that had only symbol sources measured the whole project; the step gives it a `dir .` source, and its scope stays the whole project. A rule under a module with an empty territory and other rules outside modules get no sources: without them they become `prompt`, with only symbol sources — `code` at the symbol's file. The step does not write the `delivery` field: derivation by sources yields the needed value. The step is idempotent by construction: after it no such rule is left without dir/file sources.

A consequence accepted by the operator's decision: rules with sources standing under the root (in runlith — 55b5437b, adb6798b and eight Effect-style rules) leave the startup instructions for `code`. The operator returns any of them to prompt with one switch.

## What shows that it works

The performer proves with tests through public operations (contracts only, rule 4f387de2):
- instructions: a rule without sources anywhere in the tree — in the set; a rule with a dir source — not; the same rule with `delivery: prompt` — in the set with sources in place; switching it to `code` removes it as a `Withdrawn` row;
- touch: a file under a `code`-rule dir source brings the rule; a prompt rule with the same sources does not; a rule under a module without sources no longer arrives by module territory;
- migration step: a rule under a module without dir/file sources gets the module territory; a rule with its own dir source and a rule outside modules do not change;
- `set_law_delivery`: sets and unsets the field, sources unchanged;
- typecheck of the touched packages, a live check on its own `tagma:try`: the thread's startup instructions and a file touch.

The operator checks: in gf-tagma rule 34e7d61d no longer stands in the startup instructions and arrives when `apps/api/src/app/activities/…` is read; in the app, rule delivery is visible and switchable. This is not a completion condition.
