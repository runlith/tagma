---
id: 01a0e0cf-71b2-76da-963d-3a62e04cfdcb
title: "The runlith graph follows the target module map, not the directories: each module enters the graph in its own wave, target, live sources and the law's snapshot stay apart, and runlith's opinions live in its rules"
ord: 50
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
# Tagma architecture spec · Section 8. Graph and catalog — draft v2

**Amended by section 7 ([[f7e0b9dd]], its §7.4.6 and §7.8):** in every wave, a claim that states one indivisible guarantee keeps one block with several narrow sources; source addresses, source transfers and parent moves are separate supported operations; only independent assertions split. This governs §8.7–§8.8 where they differ.

**Amended by section 1 v10 ([[f658e190]]), approved by the operator:** the target is section 1 v10 with its territory and relation registry (27 modules), which also feeds `zone-cutter`; the floor rule asks one question, while moving an enforced rule out of a dissolving zone stays a separate approval; the zones section 1 v10 redraws and the owners behavioural claims move to are named in §8.7. Each change is marked where it applies; section 1 v10 §1.13 is the source.

v2: the catalog part is rewritten over the accepted tag model (section 9, decision [[6bf40362]]); the part about work on the graph follows the review of v1 (`spec-review-08-arch-{opus,astra,fable}.md`). It rests on section 1 (decision [[f658e190]]). Everything that changes on Tagma's side is neutral; runlith's opinions are runlith's rules.

## 8.1 Problem
- **The graph repeats the current shape.** The whole server is one `#module` [[05042d40]]: 1,897 blocks, depth up to 4, with 21 areas under it, about half of which repeat technical layers ("The doors this server answers at", "The database this server keeps everything in", "The files beside the database", "What a reader is shown", "What an operation actually does").
- **The server's internal boundaries cannot be expressed** in the current vocabulary: `#area` does not carry `depends-on`; `#module` accepts only `dir`, and the doctor measures territory only by directories (`Doctor.ts:1119-1124`, `dependency.ts:37-40`); [[8779de7a]].
- **The graph describes but does not prescribe.** The project agents `.agents/zone-{cutter,builder,reviewer}.md` read folders and record what is there.
- **The doctor's queue for the project:** 1,642 `baseline-stale`, 280 `drift`; for the server 612 and 57. `baseline-stale` means there is no comparable measurement baseline, not proven lag of the code; real divergences (`drift`) are few.

## 8.2 Goal
1. The runlith graph follows the target map of section 1: modules with `depends-on`, areas inside a module — by meaning.
2. The zone agents build a zone from the target map; a divergence of the code from the target is the wave's work, not "this is how it is built".
3. The vocabulary is neutral and sufficient for the modular architecture of any project (section 9).

## 8.3 Three different things: target, live sources, the law's snapshot
- **The target** is section 1 v10 ([[f658e190]]) with its territory (v7's table amended by its appendix A) and its relation registry. A norm, not a claim about today's code.
- **The live sources of a `#module`** describe what already exists in the code. A module node is not given as a source a directory that does not exist yet.
- **The law's snapshot** is the parameters of the `modules` rule, materialized by `enforce_rule`; until the directories are homogeneous — from the target table, after the wave — from `#module`.
Therefore a module's `#module` is written **in that module's wave**, when it has its own directory (one `dir` source); until the wave the map lives only in the decision's table and in the rule's snapshot. This removes false `dependency-undeclared` findings from 27 modules laid over today's cycles, and does not require `file` sources on a module.

## 8.4 Vocabulary (over section 9)
- `#module` is a type with the `core/boundary` contract; the territory parameter (directories and files) is in the contract, and the territory reader of the doctor and of `modules` is changed in its owner's code. The "domain module" kind is a descendant type of `#module` in the catalog or in the project, not a new enumeration.
- The server's domain modules stand **under the product module** [[05042d40]] (nesting `#module` is already allowed); the claims about the package as a whole ([[8011d6b2]], [[b2d1fb42]], [[c1b228e4]]) stay with the product. Who owns the tests and the rest of the package (`drizzle/` and others) is named in the first wave's card; edges to workspace packages are set by the domain module that imports them, and `modules` measures them (the doctor does not see package imports, `dependency.ts:61,67`).
- `#reflection`, `#view`, `#proposal` — the `core` library; the spec brief — a catalog profile (section 9, §9.8).
- **runlith's opinions do not go into the shipped catalog:** "an area that repeats a technical layer is a sign of a missing module" and "code that the target says must change is written as a limitation with a wave task" are runlith rules (§8.6), not the text of the shipped `#area`/`#claim`. runlith's `#claim` is folded into the shipped catalog (section 9, §9.6).

## 8.5 Zone agents (runlith's `.agents/zone-*.md` — project content)
- **`zone-cutter`**: input — the target map (section 1 v10 with its territory), its relation registry — whose patterns become `depends-on` edges and whose ports and hooks become claims of the declaring module — and the wave's module; output — a `#module` with a `dir` source on the module's directory, `depends-on` per the map, areas per the module's card. The two lines of the current file that contradict this (a module only where the boundary law gives its own floor) are rewritten.
- **`zone-builder`**: claims from the module's code; per a runlith rule, code that the target says leaves or is cut gets a limitation claim with a wave task.
- **`zone-reviewer`**: the lens "does the zone match the target and sections 2–5"; `HOLDS` is not set over what was not read (today `zone-reviewer.md:38` allows it).

## 8.6 runlith rules — the project's architectural law
They are written when their section is accepted and are delivered by reach:
| Rule | Check |
|---|---|
| Modules: entry through the contract, `depends-on` without cycles, coverage, an unresolved import is refused | `modules` (section 1) |
| Floors inside a module | `direction` |
| Re-exports | [[8183e6ef]] (exists) |
| The zone follows the target; a layer area is a sign of a missing module; code that will go away is a limitation with a wave task | the zone reviewer's judgement |
| Names | the future `names` (section 5) |
| Data: a table has one owner | section 2 |
| Execution: the agent's path does not wait on the background | a check at run time (section 3) |
| The graph core names no catalog tags | a project program or `names` |

## 8.7 Work on the graph
**Now (section 1 accepted):** section 1 v10 ([[f658e190]]) is recorded, superseding the v7 decision and its territory table. The register's bugs are fixed (7 of 10); the three remaining are symptoms of sections 2 and 4.
**In every wave**, together with the module's code:
1. The module's `#module` — under [[05042d40]], `dir` = its directory, `depends-on` per the map.
2. **Moving the addresses** of claims with the code — `reanchor_path`.
3. **Re-hanging blocks** is a separate act: `reanchor_path` changes only the addresses of sources, not the block's place (`Sources.relocate`). Claims and areas are re-hung into the module's zone. For a rule, the place determines the reach:
   - rules without strictness and at note are re-hung freely;
   - rules at watch/gate hung on [[05042d40]] are not moved — the domains stand under the product, and these rules reach them;
   - the server refuses to move a rule at watch/gate under a disintegrating layer area (`Blocks.ts:446-454`, `rule-enforced`); moving it is a deliberate step of the wave through `enforce_rule`, a separate approval by the operator. It stays beside the floor rule's one question per [[f49f228f]] — removing the emptied entries and the rule (section 1 §1.7), which replaces the three questions ([[f658e190]]).
4. Wordings that name the old places are rewritten; the wave's zone and the affected claims outside it are checked (not the whole graph).
5. Layer areas that ended up in the module are broken up by meaning. The zones section 1 v10 ([[f658e190]]) redraws: [[70db8905]] "The agent stack a thread runs in" dissolves; [[6ca6b465]] becomes `external-harnesses`' zone; [[3ded8caa]] and [[73faac5e]] go to `native-harness`; [[e0ee2866]] to `native-harness` (a call's lifecycle) and `threads` (delivering detached results); [[09d81f01]] to `executions`; [[3b8682f2]] to `sandbox`, with the binding to `threads`; [[12972a3b]] to `change-record`, `workspace` (working bindings), `delivery` (landing), `native-harness` (workspace sources) and `external-harnesses` (root preparation, read witness); [[edd4a99c]] to `threads` (the journal, the rollout file and its lane), with the folds and evidence to `native-harness`; [[89df5e7a]] to `native-harness`, with permission rules and the library to `threads` and call presentation to `invocation`. A behavioural claim moves to the owner of its whole behaviour: authority, rights, the thread catalog and foreign keys to `threads` and `thread-record`; history per harness; `Harness` outcomes and leases to `threads`; archive, restore, settlement and merge notes to `worktrees`, `delivery` and `threads`; the enforced-law contract to `enforcement`; tool assembly and after-edit to `native-harness`; environment acquisition to `workspace`. A target claim is not verified before its code exists.
6. The doctor's findings in the module's zone are brought to zero.
7. The `modules` snapshot is updated by `enforce_rule`; the module's debt is extinguished.
**At the end:** under [[05042d40]] only the claims about the package as a whole and the domain modules; [[8779de7a]] and [[f49f228f]] removed.
**The `baseline-stale` queue** is not cleared in advance: a zone is re-read in its own wave; packages (714) and the application (362) — when they become modules.

## 8.8 What holds it
- `modules` (section 1) replaces `dependency-undeclared`.
- **Generalizing `root-parked`** (`graph/measure/checks/placement.ts`, `sources.belongs`) from the children of the root to any container with the `core/boundary` contract: a block hangs in a module other than the one whose code it **describes**. It is introduced only after distinguishing what a claim describes from what it cites as evidence (a cross-module invariant legitimately references the code of two modules, [[0a9efde2]]); until then — `modules` plus the zone review.
- Wave acceptance: the module's zone has no open findings.

## 8.9 Order
1. Section 9 (the tag model) — to the extent needed: `core/boundary` with a territory and the `core` library.
2. Zone agents (8.5).
3. The `modules` rule with a snapshot from the table (section 1).
4. Waves (8.7).
