---
id: 01a0f476-04c3-7115-9d3e-ca089140c692
title: "Tagma's architecture law at scale: a neutral core judges builtins, linters and programs against the base's accepted law, project rules live in the project, and boundaries are floors by pattern, not an allow-list"
ord: 72
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a0d4db-9d34-7461-807d-8775f5648cf9
  - kind: relates
    to: 01a0d4e4-fbe8-775c-8493-93f850467aad
  - kind: relates
    to: 01a0d54f-98aa-710d-b3fe-bb7cae56a980
  - kind: relates
    to: 01a0da9e-879c-73fc-8ddc-d74a833122ed
  - kind: relates
    to: 01a0db81-b8b3-7522-97cf-1b67dabecf26
  - kind: relates
    to: 01a0eed5-adb6-7d6f-971c-a67a083d37f1
---
Accepted law, checker pinning and the equivalence proof below are withdrawn by [[16819c00]]; the rest stands.

Designed on the operator's order by law-opus (author) and law-astra (reviewer), 2026-09-30. It proposes; nothing here is built or authorized until the operator accepts it, and no task is opened before that. The children carry the parts; this block carries the outcome, the model, the evidence and what becomes of the blocks it touches.

## 1. Outcome

- Tagma's binary holds no rule that names Tagma, runlith or a library. It ships a core that judges and keeps the ledger, two generic architecture builtins (`boundaries`, `size`), one ecosystem pack (`js`: `loads`, `platforms`), and adapters that run external checkers ([[fd53d2cb]]).
- A project adds a fast rule of its own without a Tagma release: a rule of the linter its language already has, or a program in its checks directory. The #rule names the check; nothing is compiled into Tagma.
- One judgement runs each external checker once per checker identity, whatever number of rules it serves ([[d11108eb]]).
- A gate runs only the checker the law accepted, from a prepared environment, never the working tree ([[b2965d21]]).
- Architecture law is sparse floors assigned by pattern, entries and a few prohibitions. A new feature, a new unit matching an existing category and a new package need no rule edit and no approval; a closed allow-list is opt-in ([[bedb212a]]).
- Every change is judged by the law its base accepted; a law edit never governs its own landing ([[172759d0]]).
- Programs get code facts from Tagma; languages beyond JavaScript arrive as adapters with declared capabilities ([[3f3fe425]]).
- The graph holds norms, reach, adoption, provenance and debt owners, and nothing code or config already says ([[b29472e3]]).
- The `rules` agent turns an operator's intent into adopted law in any project ([[f697d121]]); runlith migrates rule by rule ([[cdf2a89f]]) in three phases ([[8fe9d0a8]]).

## 2. What the law layer is for, and what it is not

It turns a project's accepted architecture decisions into obligations that Tagma **delivers** to the agent in the region where it writes, **judges** at landing and merge against the base so only what a change newly breaks refuses, and **keeps** as a ledger: debt owned by the work that removes it and only shrinking, escapes recorded, loosening only on the operator's word. It is the one place where the verdicts of many checkers — Tagma's builtins, the project's linters, its programs — become one refusal, one debt ledger and one vocabulary, in any language.

It is not a linter: syntax and style inside a file are the linter's, which Tagma runs and whose output it judges. It is not a type checker or a test runner (the operator's ruling in [[f5648cf9]] stands). It stores no project's or library's opinion in the product, is no list of every legal edge, and copies nothing code or manifests already declare.

## 3. Problem, with evidence

Measured in runlith at HEAD `18a488d6d1` on 2026-09-30 unless marked.

| # | Fact | Evidence |
|---|---|---|
| M1 | [[083d37f1]] holds 69 modules (27 server directories, 42 packages), 589 relations (4 testing) and 898 entries, 475 of them restricted by `for:`. Of the 585 non-testing relations, 497 follow transitively from others. Their closure is 939 pairs; an order-only model would permit 354 pairs the table forbids. | the rule's file, counted |
| M2 | Exhaustive: all 57 package→package relations are runtime `dependencies` of the importing package's manifest; the 15 manifest workspace dependencies absent from the relations are all `devDependencies`. Sampled: of 15 packages compared, 13 name exactly their manifest's `exports` targets as entries, `@runlith/git` names 11 of 12, and `@runlith/tsconfig` names no entries while exporting 3. The 511 configured package entries as a whole were not compared. | every package's `package.json` |
| M3 | Of 387 server-module entries, 58 lie under `<module>/contract/` or `<module>/testing/`; 329 are single doors mid-restructure. [[f49f228f]] already holds the server's 27-module order as sparse floors with empty debt. | [[083d37f1]], [[f49f228f]] |
| M4 | 13 rules are enforced. None carries `held-resources`, `blocking-calls`, `answer-declared` or `operations-registered` (about 1,700 lines). `names` is carried only by [[6b3210c7]], with check F4 alone; [[931cfbf1]] and [[8d3638ce]] cite the other checks and carry no enforcement. | `read_inspections` |
| M5 | Project content sits in shipped schemas: `platforms.built` is a literal union of four `@runlith/*` names; `call-services`' unblock names `invocation`; `held-resources`' messages name `@runlith/held`. The graph's field codec imports the builtin union, so a rule declared outside Tagma's source cannot decode. | `graph/contract/wire/enforcement.ts`, pack declarations |
| M6 | [[ea465bed]] carries 259 allowances `{path, symbol, form, site, why}`, 66 KB of its document. | the rule's file |
| M7 | oxlint 1.86 honours `oxlint-disable`/`eslint-disable` comments and has no flag to ignore them; one comment silences a linter-backed gate. | `oxlint --help` |
| M8 | oxlint's JS plugins do not read `.svelte` (vendor docs). runlith tracks 752 `.svelte` files: 0 hold a re-export, and 0 of the 97 in [[ea465bed]]'s region hold an Effect recovery. | `git ls-files`, grep |
| M9 | A program's debt is subtracted by a fingerprint set with no `value` comparison, where builtins compare values; a SARIF result without `partialFingerprints` is keyed `rule path: message`, so two equal violations in a file read as one. | `enforcement/programs/run.ts` 224–226, `inspection/src/core/node/judge.ts` 47–58 |
| M10 | The `.tagma` tree road absorbs a hand-edited enforcement document as it stands ([[64798cd8]], its tree-road limitation). A program with no `needs` runs from the working tree, unlanded edits included ([[2b4bf576]]). | graph, code |
| M11 | No landing budget exists in code; command rules bound a program's time ([[6b14a1ad]]). `tagma check` calls a running server. | grep, `enforcement/cli/check.ts` |
| M12 | `bun.lock` changed in 31 commits in 14 days; the packages the checkers load (`effect`, `oxc-parser`, `typescript`) changed version in none of the last 30 days. | `git log` |
| M13 | `ast-grep scan` offers `--format sarif` and `--filter <regex>`; Ruff supports no custom rules; golangci module plugins build a custom binary with `golangci-lint custom`. | vendor docs, 2026-09-30 |

The operator's benchmark (one machine): ten oxlint programs cost 3–4 s per commit against 0.3–0.4 s for one grouped run; ESLint costs 4.4–5.4 s over 1,099 files against 0.56–0.59 s for oxlint. The benchmark proves one process's throughput on file-local rules, not semantic parity: its plugin approximates `swallowed-failures` without alias resolution or Svelte.

## 4. What holds now

- Rules are graph blocks; `enforce_rule` alone writes an enforcement document of `strictness`, triggers, `inspection` (a builtin id with parameters, or an inline `command`), debt, escapes, baseline and measurement ([[64798cd8]], [[50467aad]]).
- The judge runs in-play rules one after another; builtins go to worker lanes, each program is its own process as the caller.
- Builtins are composed statically from four packs (`typescript`, `effect`, `repository`, `tagma`) in `apps/tagma/inspection/src/builtins.ts`; nothing outside Tagma's source can add one.
- Facts come from `@runlith/code-facts`, whose one adapter is `js`.
- `depends-on` between modules was removed (`18a488d6d1`); graph files are written as sorted multi-line JSON since `e4c5458678`.

## 5. The model

| Concept | What it is | Where it lives |
|---|---|---|
| **Norm** | a #rule: title and body, delivered by region | the graph |
| **Check** | one measuring unit: a builtin with its parameters, or one rule id inside a checker's output | a reference in the rule's policy |
| **Checker** | what executes: an adapter, a tool, its config, plugins or program, their dependencies and runtime; its identity is the digest of that closure | project files and the lockfile, named by a runner descriptor; the accepted digest in the adoption record |
| **Ledger** | debt (key → owner, count, value), escapes, measured time | a field of the rule, written by the server |
| **Adoption** | the record that a policy, a reach and a checker govern | a field of the rule and the journal, taken against the trusted predecessor |

A change is judged in five steps:
1. Fix the **trusted predecessor's** law: the rules accepted on the base side ([[172759d0]]).
2. Enumerate them. A candidate rule that is changed, deleted, disabled or narrowed does not govern this change.
3. Select the checks the change reaches: its paths within each rule's reach, plus the reverse-impact set ([[bedb212a]] §4.5).
4. Group the checks by checker identity, run each group once in its prepared environment, route the readings by binding key ([[d11108eb]]).
5. The core compares each key base-first — the complete base reading's count and value where it covers the key's path, the debt only where it does not — skips allowances, follows proven renames ([[d11108eb]] §4.4), then attributes lines as today.

## 6. Rejected alternatives

- **A builtin in Tagma for every project decision** (the 25–29 September pattern): about 1,700 lines with no user within days (M4), project words in shipped schemas (M5), and every new rule a Tagma release.
- **A closed allow-list by default** ([[083d37f1]]): 497 of 585 relations are transitive, 57 relations and the package entries copy manifests, and every new module is a rewrite and a question (M1, M2).
- **Keeping the per-file reading in the engine because "the gate must be the engine's law"** ([[dabecf26]]'s rejection of a lint plugin): the gate stays the engine's — judgement, debt, adoption and refusal — while the reading of one file may come from the linter the project already runs.
- The part-specific alternatives are in each child.

## 7. What becomes of the blocks this touches

Nothing is superseded or closed by this decision; each block below is revised or closed by the work that builds the part named.
- Idea [[f5648cf9]]: stays open. Its three tiers become core builtins, runner adapters with an ecosystem pack, and project checks; its list of core builtins (`imports`, `names`, `size`, `cycles`, `modules`, `patterns`) becomes `boundaries` and `size`, with `patterns` served by the ast-grep and semgrep adapters; packs installed as catalogs become manifests with files run on the caller's road.
- Decision [[ae56a980]]: stays open; its component map gains `runners/` and the packs `architecture` and `js` in `@tagma/inspection`, and its SDK and packs paragraphs are replaced by [[fd53d2cb]] and [[3f3fe425]].
- Decision [[50467aad]] (closed): contract 1 stays readable; contract 2 and runner descriptors come from [[d11108eb]]; its inline `command` moves into a descriptor.
- Decision [[833122ed]] (closed): the programs directory stands and gains the runner manifest.
- Decision [[dabecf26]] (closed): its outcome stands; `reexports` leaves the core as [[cdf2a89f]] states.
- Decision [[64798cd8]] (closed): its document becomes version 2 and its tree-road limitation is replaced by [[172759d0]].
- Idea [[2b4bf576]]: answered by [[b2965d21]] once built.
- Rule [[083d37f1]]: stands at gate until its conversion ([[cdf2a89f]]).
- Rule [[6f758080]]: its principle stands; its example becomes the core with the `architecture` and `js` packs and the runner adapters.
- Claim [[6b14a1ad]]: stands; no landing budget is introduced.
- Decisions [[26598301]] and [[243fd181]], and the claims of the Inspection and Enforcement zones: named in the children that change them.
- Decision [[6bf40362]] (the tag model): the meeting points are settled in the joint review — the law's units are never `#module` blocks, and its territory contract becomes `core/territory`, documentation ownership only ([[14e01b12]]); rules and debt owners are found through enforcement's predicate module ([[172759d0]] §4.2); the adoption digest is over the decoded policy; the one order below.
- Decision [[e04cfdcb]] (section 8): its §8.3 law snapshot taken from `#module`, §8.4 "territory reader … of `modules`", §8.5 `depends-on` edges from the zone cutter (the edge is gone since `18a488d6d1`), §8.6 rows for `modules`, `names` and the catalog-tag check, §8.7 step 7, §8.8 "`modules` replaces `dependency-undeclared`" and §8.9 step 3 contradict [[bedb212a]], [[b29472e3]] and [[cdf2a89f]]; who amends it is a question for the operator (§10).
- Decision [[f658e190]] (section 1): its relation registry stops being a parameter of law once [[083d37f1]] is converted ([[cdf2a89f]] §4.3); a sentence of it that builds the `modules` snapshot from `#module` nodes falls under the same question.

## 8. Spec-list questions

This decision answers 1 (§1), 2 (§3), 3 (§4), 4 (§5), 6 (§6) and 8 (§7).
- 5, owners: [[fd53d2cb]].
- 7, acceptance: [[8fe9d0a8]], with each child's own acceptance; 9, order: [[8fe9d0a8]] within the one order with the tag model below.
- 10 contract, 11 stored data, 12 who may do what, 13 long-lived things, 14 bounded resources, 15 rollout, 16 failures, 17 observability: answered by the child that touches each — [[d11108eb]], [[b2965d21]] and [[172759d0]] carry most of them.

## One order across the law layer and the tag model

Agreed on 2026-09-30 in the joint review of [[9140c692]] and [[6bf40362]] by both authors, reviewed by law-astra; the same text stands in both decisions.

- **A. Release N: readers and refusals; nothing is written in a new form.** The vocabulary format marker and the refusal to write or install over a newer format ([[fcaf4455]], built in [[70083b67]] D1). Enforcement's codec for document version 2, free of the builtin union, as a reader, and its refusal to write over a newer active version. Enforcement's predicate module — is this a rule, is this an open debt owner, does an adopted rule stand on this type and under which law projection — reading today's roles (`law`, `enforcement`; `work`, `decision`). The code of adoption records and of the trusted predecessor, pinning the vocabulary revision and law projection each adoption depends on, and the publication re-check ([[172759d0]]).
- **B. Release N+1 and the trust root.** The operator's migration act adopts each checkout's current rules as its accepted predecessor; it is the first write of an enforcement document version 2, and every later `enforce_rule` writes version 2. Protected judgement starts only after it. Rollback is supported down to release N once version 2 was written, never below it, because a binary older than N cannot refuse what it does not know; a rollback names its pair of binary and policy revision.
- **C. In parallel.** The law layer's "now" phase, steps 2–7 of [[cdf2a89f]] §4.4, and the tag model's steps 1–5. They meet only at the predicate module — the tag model's step 2 swaps its implementation from roles to contracts —, at the candidate's law check ([[516d96bd]] calls the adoption query; it refuses a candidate that drops the law contract from a type carrying adopted rules or changes that type's law projection, and fences and re-checks the adoption revisions at activation) and at the adoption digest ([[172759d0]] §4.1, computed over the decoded policy, never file bytes or field key names). The tag model writes its new form from its own release N+1 ([[fcaf4455]]). The `tagma` inspection pack is deleted ([[cdf2a89f]] step 6) before the `core` vocabulary library ships (tag model step 4).
- **D. Independent.** The law layer's "next" phase (`boundaries`, the conversion of [[083d37f1]]). The tag model's step 6 (`core/territory`, documentation ownership only). Its storage stage [[b4f28f40]], any time after its step 2, rewriting no enforcement document. The waves of [[e04cfdcb]]: a wave that narrows the reach of a container holding an adopted rule — through the container's own sources or a descendant's — carries that rule's re-adoption in the same change.

## 9. Dissent

None stands. law-astra reviewed the whole design twice and signed off after its last findings were corrected — a sign-off on the design, not evidence of implementation, parity or performance, which remain the phases' acceptance work: R1–R8 on the draft (runner descriptors, binding keys, duplicate debt, placement precedence, the audit criterion, sampled evidence, the migration trust root and publication races, resource exhaustion) and G1–G7 on these bodies (the base-first key comparison, several checkers for one norm, correlation fields of contract 2, the unresolved-import policy, derived inventories on the graph, two attributions of current code, references).

Positions the author changed on law-astra's evidence: placing a `top` unit lower is a loosening, not a tightening; the Effect-shaped builtins move verbatim first and to a linter later; a check without a locator gates only as an adopted count budget; the accepted law comes from the trusted predecessor, never a self-matching stamp; a conversion removing restrictions is judged by its semantic delta, not by the imports present at HEAD; `tree` checkers ship only with their base cache; no landing budget returns. law-astra took from the author: `size` as a non-parsing evaluator, one home per allowance, the checker's closure slice instead of the whole lockfile, and directive blanking in scratch copies as an adapter capability.

Joint review with the tag model [[6bf40362]], law-astra's signed statement: “law-astra independently read both complete trees, reviewed the amended meeting contracts and common build order, and signed off the reconciliation after R1–R4 were corrected. No architectural dissent remains within these two trees; this is design sign-off, not implementation, parity or performance evidence.”

## 10. Questions for the operator, from the joint review with [[6bf40362]]

1. Who amends [[e04cfdcb]] §8.3, §8.4, §8.5, §8.6, §8.7 step 7, §8.8 and §8.9 step 3, and any sentence of [[f658e190]] that builds the `modules` snapshot from `#module` nodes — neither reviewed tree owns them.
2. [[70083b67]] §2.12's sentence that [[516d96bd]] carries as pending — the tag model's question.
3. The removal of [[f49f228f]] at the end of the section 8 waves, as an `enforce_rule` act when its time comes.
