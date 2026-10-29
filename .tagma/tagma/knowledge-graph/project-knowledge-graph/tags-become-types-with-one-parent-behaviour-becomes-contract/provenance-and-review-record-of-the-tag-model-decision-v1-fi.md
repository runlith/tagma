---
id: 01a0f483-46e0-768e-af6d-83658c6307f7
title: "Provenance and review record of the tag-model decision: v1 findings, their answers, and the section 9 draft v2 verbatim"
ord: 10
---
The provenance of [[6bf40362]] and what its reviewers found. It is a record, not a standing description: the decision's current text is its parent and children.

## Provenance
- Designed from two independent models, arch-opus and arch-astra (`tag-model-arch-{opus,astra}.md`), and their cross-reviews (`tag-model-crossreview-arch-{opus,astra}.md`), merged into section 9 of the target-architecture spec (view [[46ae3e64]]). The Tana and analogues reading is `tana-facts.md` (arch-opus scratch). These files live in agents' scratch directories and leave with their threads; this note keeps what the decision took from them.
- **v1** was reviewed by arch-opus and arch-astra (`spec-review-09-arch-{opus,astra}.md`). Both: "holds with changes; not ready for the operator's approval".
- **v2** took every finding; it is kept verbatim below as it stood before its extraction into a standalone decision on 2026-09-30.
- **Extraction (2026-09-30):** the v2 text was split into the parent and eight child decisions with no change of design; paths were re-located to the restructured server where found; the meeting points with the law layer [[9140c692]] were added as proposals (parent §11).

## Review of v1 — blocking findings, all taken in v2
- **arch-opus B1 — no mechanism behind "an old server refuses to write".** The vocabulary skips a declaration it cannot read (`Tags.ts:476-489`), so an old binary seeing a new-format `#tag` drops it and its nodes lose roles, gates and law; migrations do not help (no "newer than me" check in `db/`); the installer runs at every start. Fix: two releases, a format marker in release N. → [[fcaf4455]].
- **arch-opus B2 — a refused upgrade candidate silently stays on the previous version.** Fix: a doctor finding `upgrade-blocked` for an automatic upgrade; a refusal for an explicit change. → [[516d96bd]].
- **arch-astra T9-1 — the atomic switch leaves a window between the candidate's check and its write.** The merge lost the pinning of the schema revision by every mutation that both cross-reviews had agreed. Fix: the candidate pins its source revision and checked slice; at activation, under a fence on the affected types, the accumulated delta is checked or the candidate is refused as stale. → [[516d96bd]].
- **arch-astra T9-2 — migration cannot turn every old copy into a permitted descendant.** Fix: compatible edits of permitted slots become a layer; an unknown base, a forbidden override or an incompatible declaration stay an explicit migration conflict with the former effective contract kept. → [[516d96bd]].

## Non-blocking, taken
- The `#claim` divergence is two sentences, not a paragraph (arch-opus).
- §9.3 ("storage is not rewritten") against §9.10 ("`block_tag` gets the type id"): resolved as two stages → [[42fb81f7]], [[b4f28f40]] (arch-opus).
- The compatibility of several contracts on one type was undescribed → [[877ba8f0]] (arch-opus).
- The core addresses nodes only by "supports a contract"; "type with descendants" stays with profiles and user queries → [[3a1439e4]] (arch-opus).

## Open questions answered by both reviewers
- **A.** The light/structural boundary is by the effect of the change (whether it touches carriers); the number of carriers chooses only the strategy, from a measured cost (rule [[fe83acfa]]).
- **B.** `#claim`, `#task`, `#rule`, `#decision` declare one changeable section, "project context", append only.

## Section 9, draft v2, verbatim

### Tagma architecture spec · Section 9. The tag and catalog model — draft v2

v2 takes in the review of v1 (`spec-review-09-arch-{opus,astra}.md`): the format and the refusal of old writers in two releases, the findings of a blocked upgrade, pinning of the schema revision by every writer, migration of copies without an invented base, answers to the open questions.

A decision about the Tagma product itself (not about runlith): what replaces the closed list of roles, how a project adjusts a shipped vocabulary, and how the vocabulary is upgraded. Assembled from two independent models and their cross-reviews (`tag-model-arch-{opus,astra}.md`, `tag-model-crossreview-arch-{opus,astra}.md`); the facts about Tana and its analogues are `tana-facts.md` in the arch-opus scratch. Recorded in Tagma's graph (project `core`).

#### 9.1 Problem
- **A closed list of roles in the core's code** (`protocol/tags/shape.ts`: `status, holder, work, decision, claim, container, law, amendment, leaf, observation, enforcement`). New core behaviour is an edit of the core; `#idea` and `#research` have no roles, so the spec brief and `Batch` name tags as literals (`graph/orientation/Orientation.ts:960-1023`, `graph/work/Batch.ts:130`).
- **A local edit is a copy.** runlith's `#claim` has diverged from the shipped one: the project has two sentences about the date in the stamp, the shipped one has a paragraph about numbers; neither difference is about runlith. On a conflict the installer ([[cfa23151]]) keeps the local version, and upgrades stop arriving.
- **System matter in a domain catalog:** `#reflection` (friction with Tagma itself) is declared in `code-project` (`codeProject.ts:98`).
- **Closed enumerations and shape:** the `#module` kinds `kit|product|surface|substrate`, sources only `dir`; a domain module inside a product cannot be expressed, and the doctor measures territory only by directories (section 8).
- **The name is the identity:** renaming a tag that has carriers is refused (`Blocks.ts:314-339`); two catalogs with the same tag name collide.

**The fact about Tana** (arch-opus research): supertag inheritance and search by the base tag exist; upgrades of shared templates do not — an installed template is a copy forever. The same holds for Logseq, Anytype, Notion, Capacities, Obsidian. None of the systems studied solves the problem of "upgrading a project that has local edits"; package systems (ESLint shareable configs, VS Code settings, Kustomize, dpkg conffiles) solve it with a delta by key and an explicit question on conflict.

#### 9.2 Model: three concepts instead of roles
1. **Type** — what a thing is: fields, gates, named text sections, **one** `extends` (a substantive parent). A new kind (`idea`, `research`, a domain module) is data only.
2. **Behaviour contract `core/*`** — what the core does with it: a parameterized descriptor (which fields it is bound to, which words mean what, which actions), implemented by the owning module and registered by its manifest. There is no central list. A type may support **several compatible** contracts: for example, a decision — lifecycle + evidence + promise. New behaviour is its owner's code and descriptor, with no edit of a shared enumeration.
3. **Catalog profile** — how a catalog presents its types: brief sections, creation defaults, commands. Tag literals leave the core.

**Meaning is not mechanism** (the translation rule): a promise and an amendment carry evidence but are not "a statement of the present"; a leaf without children ≠ a saved selection; a user observation ≠ a Tagma reflection. So roles are not translated mechanically: each gets its own contract and its own migration check.

#### 9.3 Identity
- A type and a field have **permanent logical ids**; a shipped one has a provenance (library + export + version), a local one has the id of its declaration. The name is an alias within the project; a name conflict between two catalogs is resolved by an alias at installation.
- First stage: storage is not rewritten (`block.tags`, `block_tag`, fields by name); a resolver links the former key to the permanent id, and the former key becomes an immutable compatibility key. An id column in `block_tag` and the physical migration of storage are a separate, bounded stage.
- References (`extends`, the targets of reference fields, saved queries) store ids, not names.

#### 9.4 Composition and conflicts
- One declaration compiler: base + local layer + ancestors + contracts → the resulting schema, with the provenance of every part. No "first/last wins".
- Required gates combine by "and". A lifecycle is checked whole, as one state machine: a union of the allowed transitions is forbidden (it weakens the law: one machine allows `open→done`, another requires `open→review→done`). Enumerations are checked together with the transitions and terminality, not by a simple intersection. Open contributions (allowed edges, sources) widen only where the base contract declared the slot open.
- One single-valued state (status, holder) belongs to one binding owner; two machines over it are refused.
- Several tags on a block are kept and checked as now (`Tags.assertComposable`, [[033d8746]]): they compose or are refused.
- Several contracts on one type are compatible if their bindings share no field and no single-valued state and their requirements (the `work` contract requires `lifecycle`, `enforced` requires law) close; a shared dependency is deduplicated only when its fields, parameters and actions are identical.
- Core functions find nodes only through "supports a contract", never by a project's type.

#### 9.5 Queries
Three kinds: **exact type**, **type with descendants**, **supports a contract**. The former saved selectors and gates (`tags:`, `open-children tag: task`) migrate as **exact** — otherwise the migration would silently widen the set (for example, of blocking children). An inheriting search is an explicit choice of a new query.

#### 9.6 How a project changes what is shipped — four levels
The scheme of package systems (ESLint, VS Code, Kustomize, dpkg):
1. **A parameter or a section by key** — only in the slots and sections the type declared changeable: append, replace, hide a section. The local layer stores the section key and the revision of the base it was accepted over. Upgrades of the shipped type arrive.
2. **Its own descendant type** (`#bug extends #task`) — a new project type.
3. **An explicit fork** — when one wants to rewrite more than is allowed: a project type with the record "fork of `<library>#<type>` at revision X". Upgrades of this type stop arriving; changes to the shipped type arrive as information ("a new version is out, here is the difference"), not as a conflict.
4. **A request to the shipped catalog** — a narrow case that gets in the way of many — a reflection in Tagma's graph, so that the catalog adds a parameter.

A project never rewrites a contract's behaviour: if different behaviour is needed, it is a different type with a different contract (a note instead of a claim).

The types Tagma ships (`#claim`, `#task`, `#rule`, `#decision` …) declare **one section, "project context", append only** as changeable; the shared contract cannot be hidden or replaced. A project's opinions on how to write are its `#rule`s, not the type's text. The current divergence of runlith's `#claim` (two sentences) is folded into the shipped catalog rather than becoming a layer.

**The finding `layer-stale`**: the shipped catalog changed or removed a section the project had replaced or hidden. It means "a change is hidden by a local layer, and the decision has not been updated", not "the local text is false". The resolution is to keep the replacement deliberately over the new base, change it, or remove it; the agent decides, and it goes to the operator only if the meaning of a project rule changes.

#### 9.7 Upgrade and rollback
- **A candidate is checked before it is switched on:** the declaration, descendants, carriers, the effect on law. The kind of change decides whether the carriers need checking: text, alias and layout do not touch them — one write unit, as now (`installCatalogs.ts:61`). A change that touches carriers checks them; the number of carriers decides only the strategy: fit into one unit, or preparation in batches outside the writer, a short lock on the affected types, an atomic switch-on. The threshold is derived from the measured cost of the check on the machine, not set as a number.
- **Every mutation pins the schema revision** it was written under; at the switch-on under the lock, the delta of carriers changed since the background check is checked. A candidate prepared over a revision that has already been replaced goes stale and is not switched on — it is prepared again.
- **Two different cases of a candidate's refusal:**
  - **An automatic upgrade of an already installed catalog** (start, project birth `Projects.ts#ensureVocabulary:464-480`): the project is not brought down, the previous active version stays, and a doctor finding `upgrade-blocked` with the reason is placed on the `#catalog`. For a fork, a new revision of the shipped type is an informational finding.
  - **An explicit change of the set of catalogs** (`graph.catalogs`, `Settings.ts:414`) and a first installation: the setting change **is refused** with the reason, as now — the setting and the installation stay one unit ([[69f7d9c6]]). "Accepted but not active" does not exist; at a first installation there is no previous version, so it is only a refusal. An explicit change is atomic in the checkout it is written through and orders the project's requested set; the project's other checkouts, and every project following a user-scope value, take it as an automatic update (clarified by section 2 §2.12 of the runlith spec).
- **A wrong local part is not switched off automatically** (that could remove the project's protection): the candidate is switched on whole after the check, or the previous version stays; an independent part can be released as a separate candidate.
- **Rollback** is a checked reverse migration over the current state, not a substitution of the base; if it cannot be done without data loss — a refusal and a direct fix.
- **An old server refuses to write after the transition — in two releases.** Today the vocabulary silently drops a declaration it cannot read (`Tags.ts:476-489`), and nodes lose their roles together with gates and law; there is no "the base is newer than me" check. Therefore: **release N** introduces a vocabulary format marker and a refusal to write (and a refusal to install a catalog) if the marker is newer than the server understands; **release N+1** writes the new form. The former declaration form is only a derived representation for reading during the transition, not a second mutable canon; it is removed once no unsupported readers remain.
- A vocabulary upgrade does not change the strictness or the snapshot of law (`#rule` with enforcement) — only `enforce_rule` does.

#### 9.8 The system library and catalogs
- The metalanguage `#tag`, `#catalog` is the core.
- **The `core` library** ships the `core/*` contracts and the system types: `#view`, `#proposal` (installation profile defaults; a project may choose its own type with the same contract) and `#reflection`. `file_reflection` writes into the graph of Tagma's sources (`Reflection.home`, [[6b35c2af]]); the reflection type is provided there, not necessarily in every project. `code-project` no longer has `#reflection`.
- **Domain catalogs** (`code-project` and future ones) are versioned libraries: types, a brief profile, defaults. The standard types are defaults, not a ban on another vocabulary.
- **`#module`** is a type with the `core/boundary` contract (a territory parameter: directories and files); a domain module is a descendant of `#module`. The territory reader of the doctor and of `modules` is changed in its owner's code (section 8).

#### 9.9 Neutrality
- Two contradictory workflows (`strict-code`, `free-writing`) are two types bound to `core/work`; `ready_tasks` finds both by the contract, and `finish_block` applies the machine of its own node.
- A book project works on `core/truth`, `core/work`, `core/law` with `node`/`url`/`date` sources and sees none of the core's words except the contract ids in the declarations.
- Code checks are switched on by an explicit measurable territory or a check profile, not by the fact that one abstract type can accept a file: today's `TagTable.bindsCode()` (`TagTable.ts:95-96`) would become true in a book too once the system library is loaded.

#### 9.10 Migration
- Nodes and their data, history and verdicts are preserved; `block_tag` gets the type id in a separate storage stage (§9.3), and until then goes through the resolver.
- Roles are translated into contract bindings by a table, **each role separately, with a check** (§9.2): the former answers and prohibitions over existing data are the first criterion of the migration.
- A local copy becomes a descendant of the shipped type **only if** its base is known (`release.tags`) and its differences fall into slots the new shipped type allows. Otherwise — an unknown base, a difference in a closed slot, an incompatible old declaration — the copy **keeps its former effective contract** with a "migration conflict" finding until one of the outcomes: fold the difference into the shipped catalog, declare an explicit fork, or convert under authorization. Bases and permissions are not invented; text is not reconstructed by guessing from a diff.
- Saved selectors and gates — as exact.

#### 9.11 What stays as it is
Several tags on a node; `SOURCE_KINDS` and `FIELD_SCHEMA_NAMES` (opened on a concrete need, by their owner); behaviour is core code, with no external plugins; a catalog revision is a hash.

#### 9.12 Performance
A cache of the resulting schema per type and revision; a reverse index of the affected descendants and carriers; a text edit does not trigger a pass over the corpus.

#### 9.13 What holds it
- The declaration compiler's refusals (§9.4) at write and at the switch-on of a candidate.
- `layer-stale`, `upgrade-blocked`, "migration conflict" and the fork's informational finding — in the doctor's queue.
- The vocabulary format marker and the refusal of old writers.
- The check "the core names no catalog tags" — a Tagma project program or a future `names`.
- The neutrality test (§9.9) — a system test of what Tagma ships: two contradictory catalogs and a project without code on one engine.

#### 9.14 What it changes in other sections
- **Section 8** (the catalog part): "two new roles", "the `domain` kind", "`file` sources on `#module`", "`#reflection` out of the catalog" are replaced by §9.8; the neutrality of catalog edits — §9.6.
- **Section 1:** the `#module` nodes of runlith's modules are descendants of `#module` with the `core/boundary` contract and a territory; the `modules` snapshot is built from them.

#### 9.15 Order
0. Release N: the vocabulary format marker and the refusal to write and to install on a newer format (§9.7).
1. The declaration compiler and identity (§9.3–9.4), preserving the former answers.
2. The `core/*` contracts at their owners, translating roles one at a time.
3. Queries of the three kinds.
4. The `core` library and moving the system types out of `code-project`; the brief onto the profile.
5. Layers, `layer-stale`, fork, an installer with a candidate and an atomic switch-on.
6. `core/boundary` with a territory for section 8.

#### 9.16 Settled by review
- The "light / structural" boundary is by the effect of the change (whether it touches carriers); the number of carriers chooses the check strategy (§9.7). Both reviewers.
- What is changeable in shipped types is one section, "project context", append only (§9.6). Both reviewers.
