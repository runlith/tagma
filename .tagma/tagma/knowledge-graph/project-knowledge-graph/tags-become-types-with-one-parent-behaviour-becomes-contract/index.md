---
id: 01a0e0cb-0087-794e-be47-9dc36bf40362
title: Tags become types with one parent, behaviour becomes contracts owned by core modules, and a project changes a shipped type only by declared additions, a subtype or an explicit fork
ord: 213
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a0e0cf-71b2-76da-963d-3a62e04cfdcb
  - kind: relates
    to: 01a0e0e6-610c-7b6a-a755-814b46ae3e64
  - kind: relates
    to: 01a0f476-04c3-7115-9d3e-ca089140c692
---
A decision about the Tagma product itself, not about runlith: what replaces the closed list of tag roles, how a project adjusts a shipped vocabulary, and how a vocabulary is upgraded. It was written as section 9 of the target-architecture spec (the view [[46ae3e64]]) and stands here whole. The children carry the parts that change independently; this block carries the outcome, the problem, the model as one picture, owners, acceptance, the fate of what it touches, the order, and where it meets the law layer [[9140c692]]. Its provenance and the review record are the note [[8c6307f7]].

## 1. Outcome

- A tag is a **type**: fields, gates, named text sections and at most one substantive parent (`extends`). A new kind — `#idea`, `#research`, a domain module, a project's `#bug` — is data, never a core edit ([[3743b582]]).
- What the core does with a node is a **behaviour contract `core/*`**, implemented and registered by its owning module; the core finds nodes only by "supports a contract", never by a tag's name ([[877ba8f0]], [[3a1439e4]]).
- Types and fields have **permanent ids**; a name is an alias, so a tag with carriers can be renamed and two catalogs using one name do not collide ([[42fb81f7]]).
- A project changes a shipped type only by a **declared addition, a subtype or an explicit fork**; upgrades of what it did not fork keep arriving, and a conflict is a finding, not a silent local copy ([[516d96bd]]).
- An upgrade is a **checked candidate switched on atomically**; a blocked automatic upgrade leaves the previous version active, and an old server refuses to write a vocabulary newer than it understands ([[516d96bd]], [[fcaf4455]]).
- System types (`#view`, `#proposal`, `#reflection`) leave the domain catalog for the `core` library; a catalog profile carries brief sections and defaults ([[3087c3ed]]).
- `#module` carries a territory of directories and files through a contract, so a domain module can be expressed ([[14e01b12]]).

## 2. Problem, with evidence

Paths are as measured for draft v2, before the server restructure; the current homes are named in brackets where they were re-located on 2026-09-30.

- **A closed list of roles in the core** (`protocol/tags/shape.ts`; now `graph/contract/wire/tags/declaration.ts`, with `OWNED_ROLES` at :112): `status, holder, work, decision, claim, container, law, amendment, leaf, observation, enforcement`. New core behaviour is a core edit; `#idea` and `#research` bind no role, so the spec brief and the batch name tags as literals (`graph/orientation/Orientation.ts:960-1023`, `graph/work/Batch.ts:130`; now `graph/orientation/briefs.ts:166,215`, `graph/work/Batch.ts:101`).
- **A local edit is a copy.** runlith's `#claim` diverged from the shipped one — two sentences about the date in the stamp against a shipped paragraph about numbers, neither about runlith. On a conflict the installer keeps the local value ([[cfa23151]]), and upgrades stop arriving.
- **System matter in a domain catalog:** `#reflection` (friction with Tagma itself) is declared in `code-project` (`catalogs/contract/wire/codeProject.ts:98`).
- **Closed enumerations and shape:** `#module` kinds `kit|product|surface|substrate`, sources `dir` only; a domain module inside a product cannot be expressed, and the doctor measures territory only by directories.
- **The name is the identity:** renaming a tag with carriers is refused (`Blocks.ts:314-339`; now `graph/blocks/update.ts:59-87`, `carriers-invalid`); two catalogs with one tag name collide.
- **An old server silently drops what it cannot read:** a declaration its grammar does not read is skipped (`Tags.ts:476-489`, not re-located in this extraction), and the nodes lose its roles with their gates and law; nothing checks "the store is newer than me".

**External reading** (`tana-facts.md`, research by arch-opus): Tana has supertag inheritance and search by the base tag, but no upgrade of shared templates — an installed template is a copy forever; the same holds for Logseq, Anytype, Notion, Capacities and Obsidian. Package systems (ESLint shareable configs, VS Code settings, Kustomize, dpkg conffiles) solve "upgrade under local edits" with a delta by key and an explicit question on conflict.

## 3. What holds now

- Several tags on one block compose or are refused (`assertComposable`, `graph/vocabulary/declarationRules.ts:119`; [[033d8746]]).
- A catalog is a `#catalog` node whose `release` field records the shipped base ([[01de8089]]); installation upgrades in place, merges parts whose base is known and keeps the local value on a conflict ([[cfa23151]]).
- Every project's vocabulary is ensured at birth and at open (`graph/serving/birth.ts`, `ensureVocabulary`); a text-only install is one write unit.
- A `graph.catalogs` write installs in the same unit as the setting change ([[69f7d9c6]] for its served-project exception).
- `file_reflection` writes into the graph of Tagma's own sources (`Reflection.home`, `graph/work/filedReflections.ts`; [[6b35c2af]]).
- `TagTable.bindsCode()` (now `graph/vocabulary/tagIndex.ts:72`) switches code checks on when any tag can take a file source.

## 4. The model

| Concept | What it is | Child |
|---|---|---|
| **Type** | fields, gates, named sections, one `extends`; composed by one declaration compiler | [[3743b582]] |
| **Identity** | permanent ids; names are aliases; references store ids | [[42fb81f7]], storage [[b4f28f40]] |
| **Behaviour contract** `core/*` | a parameterized descriptor its owning module implements and its manifest registers; several compatible per type | [[877ba8f0]] |
| **Query** | exact type, type with descendants, supports a contract | [[3a1439e4]] |
| **Catalog profile and libraries** | brief sections, creation defaults, commands; the `core` library of system types; domain catalogs as versioned libraries | [[3087c3ed]] |
| **Layer, subtype, fork** | the four levels of change and the upgrade road | [[516d96bd]] |
| **Format marker** | the refusal of old writers, then the new form | [[fcaf4455]] |
| **Territory** | `#module`'s territory through a contract | [[14e01b12]] |

**Meaning is not mechanism** (the translation rule): a promise and an amendment carry evidence but are not a statement of the present; a leaf without children is not a saved selection; a user's observation is not a Tagma reflection. Roles are therefore never translated mechanically — each gets its own contract and its own migration check.

**Neutrality.** Two contradictory workflows (`strict-code`, `free-writing`) are two types bound to `core/work`; `ready_tasks` finds both by the contract, and `finish_block` applies the machine of its own node. A book project works on `core/truth`, `core/work`, `core/law` with `node`/`url`/`date` sources and sees none of the core's words except contract ids in declarations. Code checks switch on by an explicit measurable territory or a check profile, never because one abstract type can take a file — today's `bindsCode()` would turn true in a book once the system library loads.

**What stays as it is:** several tags on a node; `SOURCE_KINDS` and `FIELD_SCHEMA_NAMES` (opened on a concrete need, by their owner); behaviour is core code with no external plugins; a catalog revision is a hash.

## 5. Owners and boundaries

- `#tag` and `#catalog` — the metalanguage — are the core.
- The graph module owns the declaration compiler, the resolver, the query kinds, catalog installation and activation, and the vocabulary format marker (with its store stamp as section 2 [[70083b67]] places it).
- Each `core/*` contract is owned by the module whose behaviour it names and registered in that module's manifest; there is no central list of contracts (rule [[edea5454]]).
- The doctor's new finding kinds are declared by the owner that raises them.
- Domain catalogs (`code-project` and future ones) are versioned libraries owned by their catalog package; the `core` library ships with Tagma.

## 6. Rejected alternatives

- **Copy-on-install templates (Tana and its analogues):** an installed copy never receives an upgrade — the problem this decision exists to solve.
- **Keeping the role list and adding roles:** every new behaviour stays a core edit, and meanings are merged by mechanism.
- **More than one substantive parent:** the model takes exactly one `extends`; reuse of behaviour across types comes from several compatible contracts on one type ([[877ba8f0]]).
- The part-specific alternatives are in each child.

## 7. Acceptance criteria

- The declaration compiler's refusals hold at write and at a candidate's switch-on ([[3743b582]]).
- `layer-stale`, `upgrade-blocked`, "migration conflict" and the fork's informational finding stand in the doctor's queue ([[516d96bd]]).
- An old server refuses to write and to install over a newer vocabulary format ([[fcaf4455]]).
- A check "the core names no catalog tags" holds over the core's source — a runlith check in `checks/` (the per-file literal positions as an oxlint rule), adopted when the operator enforces it; the `names` builtin dissolves ([[cdf2a89f]]).
- The neutrality test: a system test of what Tagma ships — two contradictory catalogs and a project without code on one engine.
- Every child's own acceptance.

## 8. What becomes of the blocks it touches

- Claim [[cfa23151]] (installer keeps the local value on conflict): replaced by claims written from the layered installer ([[516d96bd]]).
- Claim [[01de8089]] (catalog node, `release` field): rewritten from the code once layers and provenance land.
- Claim [[033d8746]] (tags compose or are refused): stands; rewritten if the compiler takes its place.
- Claim [[69f7d9c6]] (catalog installed before the machine row): rewritten by section 2's catalog request ([[70083b67]] §2.4.9).
- Claim [[6b35c2af]] (`Reflection.home`): stands; the reflection type moves to the `core` library ([[3087c3ed]]).
- Decision [[e04cfdcb]] (section 8): its catalog part rests on this decision — `#module` with a territory contract, the `core` library, the neutrality of catalog edits; its "two new roles", "the `domain` kind", "`file` sources on `#module`" and "`#reflection` out of the catalog" are replaced by [[3087c3ed]] and [[14e01b12]]. Its passages that build law from `#module` nodes or `depends-on` edges contradict both this decision and the law layer; who amends them is an operator question (§11).
- Decision [[f658e190]] (section 1): the `#module` nodes of runlith's modules become descendants of `#module` with the territory contract and a territory. They are documentation ownership only: the law's units come from selectors and manifests ([[b29472e3]]), so no law snapshot is built from them (settled in the joint review, §11 point 1).
- Idea [[69025288]] (a catalog declaring what a decision must answer): its home is the catalog profile ([[3087c3ed]]).
- No task exists for this decision; none is opened by this extraction.

## 9. Order of building

0. The vocabulary format marker and the refusal to write and to install over a newer format ([[fcaf4455]]; built in section 2's D1, [[70083b67]]).
1. The declaration compiler and identity, preserving the former answers ([[3743b582]], [[42fb81f7]]).
2. The `core/*` contracts at their owners, translating roles one at a time ([[877ba8f0]]).
3. Queries of the three kinds ([[3a1439e4]]).
4. The `core` library and moving the system types out of `code-project`; the brief onto the profile ([[3087c3ed]]).
5. Layers, `layer-stale`, fork, an installer with a candidate and an atomic switch-on ([[516d96bd]]).
6. The territory contract for section 8 ([[14e01b12]]).
The storage stage ([[b4f28f40]]) is separate and bounded, after step 2.

### One order across the law layer and the tag model

Agreed on 2026-09-30 in the joint review of [[9140c692]] and [[6bf40362]] by both authors, reviewed by law-astra; the same text stands in both decisions.

- **A. Release N: readers and refusals; nothing is written in a new form.** The vocabulary format marker and the refusal to write or install over a newer format ([[fcaf4455]], built in [[70083b67]] D1). Enforcement's codec for document version 2, free of the builtin union, as a reader, and its refusal to write over a newer active version. Enforcement's predicate module — is this a rule, is this an open debt owner, does an adopted rule stand on this type and under which law projection — reading today's roles (`law`, `enforcement`; `work`, `decision`). The code of adoption records and of the trusted predecessor, pinning the vocabulary revision and law projection each adoption depends on, and the publication re-check ([[172759d0]]).
- **B. Release N+1 and the trust root.** The operator's migration act adopts each checkout's current rules as its accepted predecessor; it is the first write of an enforcement document version 2, and every later `enforce_rule` writes version 2. Protected judgement starts only after it. Rollback is supported down to release N once version 2 was written, never below it, because a binary older than N cannot refuse what it does not know; a rollback names its pair of binary and policy revision.
- **C. In parallel.** The law layer's "now" phase, steps 2–7 of [[cdf2a89f]] §4.4, and the tag model's steps 1–5. They meet only at the predicate module — the tag model's step 2 swaps its implementation from roles to contracts —, at the candidate's law check ([[516d96bd]] calls the adoption query; it refuses a candidate that drops the law contract from a type carrying adopted rules or changes that type's law projection, and fences and re-checks the adoption revisions at activation) and at the adoption digest ([[172759d0]] §4.1, computed over the decoded policy, never file bytes or field key names). The tag model writes its new form from its own release N+1 ([[fcaf4455]]). The `tagma` inspection pack is deleted ([[cdf2a89f]] step 6) before the `core` vocabulary library ships (tag model step 4).
- **D. Independent.** The law layer's "next" phase (`boundaries`, the conversion of [[083d37f1]]). The tag model's step 6 (`core/territory`, documentation ownership only). Its storage stage [[b4f28f40]], any time after its step 2, rewriting no enforcement document. The waves of [[e04cfdcb]]: a wave that narrows the reach of a container holding an adopted rule — through the container's own sources or a descendant's — carries that rule's re-adoption in the same change.

## 10. Dependencies on other blocks

- **[[70083b67]] (section 2), D1:** builds step 0 — `graph_stamp.vocabulary_format` and `vocabulary_revision`, the tree descriptor `.tagma/<project>/format.json`, the old-writer refusal in the store's open and in freshness, and the vocabulary revision each `graph_act` records (this decision's revision fence).
- **[[70083b67]] §2.4.9 and §2.12:** the project-scope catalog request in the machine store; §2.12 proposes one sentence for [[516d96bd]] — "An explicit change is atomic in the checkout it is written through and orders the project's requested set; the project's other checkouts, and every project following a user-scope value, take it as an automatic update." It is carried in [[516d96bd]] as pending the operator's approval of §2.12, not as accepted text.
- **[[e04cfdcb]] (section 8):** consumes [[14e01b12]] and [[3087c3ed]]; its step 1 needs this decision only to that extent.
- **[[9140c692]] (the law layer):** the meeting points below.

## 11. Where it meets 9140c692 — settled in the joint review

Settled on 2026-09-30 with the law layer's author (law-opus), with law-astra as independent reviewer; [[9140c692]]'s tree states the same at each point. Each side edited only its own tree.

1. **The law's units come from selectors and manifests, never from `#module` blocks** ([[b29472e3]], [[bedb212a]]; evidence M1, M2 and the `depends-on` edges that rotted). The territory contract is renamed `core/territory` and serves documentation ownership only — `read_owners`, the doctor's `area-void` and owner-spread ([[14e01b12]]); no law snapshot is built from it.
2. **One predicate module owned by enforcement** answers "is a rule", "is an open owner" and "does an adopted rule stand on this type". Today it reads roles — `regionOf` walks the `law` role (`enforcement/rules/reach.ts:38`); after [[877ba8f0]] it reads contracts, one implementation swap. The predecessor's rules ([[172759d0]] §4.2) are enumerated through it. [[516d96bd]]'s candidate check calls the third query: a candidate that drops the law contract from a type carrying adopted rules, or changes that type's law projection (which field is the enabled switch, which holds the enforcement document, the law contract's version), is refused — `upgrade-blocked` for an automatic upgrade, a refusal for an explicit change — and activation fences and re-checks the adoption revisions (law-astra's R1).
3. **Debt owners are judged by contract** through the same predicate: a node supporting the work contract or the promise lifecycle, in a non-terminal state, not replaced. Today: the `work`/`decision` roles, non-terminal, not superseded (`enforcement/rules/enforce.ts:104-108`).
4. **The adoption digest** ([[172759d0]] §4.1) is over the decoded policy in canonical form, independent of file bytes and field key names; the reach identity is the region's id plus the minimal source-prefix set the reach resolves to within the rule's base — a reach already includes every live descendant's sources ([[feab0c98]], `reach.ts:42-55`) — never the expanded file list. A new block under a covered prefix changes nothing. [[b4f28f40]] never rewrites an enforcement document; a rule's document changes form only at its next `enforce_rule`.
5. **Section 8's waves turn no enforced rule pending.** Counted: the 13 enforced rules stand in 5 containers — the project root (6), the server module [[05042d40]] (3), [[d1caad35]] (1), [[5e1647fa]] (2), [[249ce587]] (1). [[e04cfdcb]] keeps watch/gate rules on [[05042d40]] and nests domain modules under it; every wave source lies under a prefix already covered. General rule, stated in [[172759d0]]: a container re-source or a move that narrows an adopted rule's reach goes pending and is re-adopted in the same change; moving an enforced rule stays refused except through `enforce_rule`.

**Minor, settled.** The `tagma` inspection pack is deleted in the law layer's "now" phase ([[cdf2a89f]] step 6) before the `core` vocabulary library ships ([[3087c3ed]]), so no rename. "The core names no catalog tags" becomes a runlith check in `checks/`, since `names` dissolves. Enforcement's version 2 codec, free of the builtin union ([[fd53d2cb]]), is where `#rule`'s `law`/`enforcement` roles become the law contract registered in enforcement's manifest. The in-flight re-enforcements of [[083d37f1]] and [[50520d64]] land first; [[cdf2a89f]] takes each ledger as it then stands.

**Review corrections.** law-astra's review found four contract gaps, all corrected in both trees: R1, the candidate preserves the adopted law's projection and activation re-checks adoption revisions ([[516d96bd]], [[172759d0]]); R2, a `#module` move that changes a rule-bearing reach obeys [[172759d0]] and reach is one definition for delivery and judgement ([[14e01b12]], [[b29472e3]]); R3, the publication re-check is built before the trust root; R4, release N writes no new form on either side and refuses mutation of an active version 2 document ([[fcaf4455]], [[172759d0]]).

**Sign-off, law-astra's statement:** “law-astra independently read both complete trees, reviewed the amended meeting contracts and common build order, and signed off the reconciliation after R1–R4 were corrected. No architectural dissent remains within these two trees; this is design sign-off, not implementation, parity or performance evidence.”

**Questions for the operator** (neither tree decides them):
1. Who amends [[e04cfdcb]] §8.3 (snapshot from `#module`), §8.4 ("territory reader … of `modules`"), §8.5 (`depends-on` edges, removed in `18a488d6d1`), §8.6 rows `modules`/`names`, §8.7 step 7, §8.8 and §8.9 step 3, which build law from `#module` nodes or `depends-on` and contradict both trees — and [[f658e190]]'s line if it states the same.
2. [[70083b67]] §2.12's pending sentence for [[516d96bd]].
3. The end-of-waves removal of [[f49f228f]] ([[e04cfdcb]] §8.7) as an `enforce_rule` act when its time comes.

## 12. Spec-list questions (rule [[8dab19b6]])

1 outcome §1; 2 problem §2; 3 what holds §3; 4 target §4 and the children; 5 owners §5; 6 rejected §6 and the children; 7 acceptance §7; 8 fates §8; 9 order §9.
- 10 Contract: the declaration's shape and its format version — [[fcaf4455]], [[3743b582]].
- 11 Stored data: [[42fb81f7]], [[b4f28f40]], migration of copies in [[516d96bd]].
- 12 Who may do what: [[516d96bd]] (who resolves `layer-stale`, what goes to the operator); a vocabulary upgrade never changes law's strictness — only `enforce_rule`.
- 13 Long-lived things: candidates and their revision fence — [[516d96bd]].
- 14 Bounded resources: a cache of the resulting schema per type and revision, and a reverse index of affected descendants and carriers; a text edit triggers no pass over the corpus; the carrier-check strategy is derived from its measured cost — [[3743b582]], [[516d96bd]].
- 15 Rollout: two releases — [[fcaf4455]].
- 16 Failures: a blocked automatic upgrade keeps the previous version; an explicit change is refused whole — [[516d96bd]].
- 17 Observability: the four finding kinds in the doctor's queue — [[516d96bd]].
