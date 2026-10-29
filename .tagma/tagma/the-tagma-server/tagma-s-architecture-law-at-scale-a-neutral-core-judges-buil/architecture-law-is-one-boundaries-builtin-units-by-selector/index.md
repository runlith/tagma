---
id: 01a0f476-04fc-7cb9-bf49-deb7bedb212a
title: Architecture law is one `boundaries` builtin — units by selector and manifest, floors assigned at birth by category, ordered entries, a few prohibitions, cycles on real imports — so new features need no rule edit, and a closed relation list is opt-in
ord: 4
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
Part of [[9140c692]]. It fixes the model of architecture law — what a project declares, what Tagma derives, and why the law does not grow with the code.

## 1. Outcome

- One builtin, `boundaries`, replaces `direction` and `modules`. A project declares units by pattern, their floors by category, what each unit exposes, a few prohibitions, and whether cycles are refused.
- A new feature inside a unit, a new unit matching an existing category, a new import along the order and a new package dependency need no rule edit and no approval. A rule changes only for a new category or an upward import — a real architecture change.
- A closed relation list (today's `modules`) stays available and is chosen explicitly, never by default.
- `size` ratchets a per-file metric in any language without parsing.
- A change that makes an unchanged file violate is judged, not left to escape.

## 2. Problem, with evidence

[[9140c692]] M1–M3: [[083d37f1]] is a closed list whose relations are mostly transitive (497 of 585) and whose package half copies manifests (all 57 package relations are manifest dependencies), so every new module and every legitimate new import is a rule rewrite and, as a loosening, a question to the operator. `direction` measures a path on no floor "in neither direction" ([[f49f228f]]), so every new top-level directory must be placed by hand in the change that adds it. `modules` checks cycles in its declared relations, not in imports. [[550755a6]] lets a crossing induced in an unchanged file escape a landing.

## 3. What holds now

`direction` applies a floor table under `base` ([[3abaa819]]); `modules` applies territories, entries (`for`, `port`, `testing`), relations, cycles over the table, coverage and unresolved handling; both read imports and workspace resolution through `@runlith/code-facts`. `names` F4 ratchets non-import lines ([[6b3210c7]]).

## 4. Target model

### 4.1 `boundaries`

```yaml
units:                              # ordered selectors; the first that captures a path owns it
  - { select: "src/modules/{unit}/", category: feature }
  - { select: "src/infra/{unit}/",   category: infra }
  - { select: "src/common/",         unit: common }
floors:                             # bottom first; an entry names a unit or a category
  - [common]
  - [category: infra]
  - [category: feature]
inner: { "*": [contract/wire/] }    # a unit's own order, bottom first, judged only inside one unit
unplaced: refuse                    # top | refuse | out, for a unit on no floor
siblings: allow                     # allow | cross, between units of one floor
entries:                            # ordered; the first matching entry decides a target path
  - { pattern: "*.module.ts" }
  - { pattern: "*.service.ts" }
  - { pattern: "dto/**" }
  - { pattern: "testing/**", role: testing }
prohibitions:
  - { from: "**/*.controller.ts", to: "src/infra/db/**" }
cycles: refuse                      # measured on real imports between units
coverage: default                   # default | refuse
unresolved: refuse                  # refuse | unjudged, for an import aiming inside the region that resolves to nothing
relations: order                    # order | [ { from, to, role? } ] — the closed mode
```

This is one coherent policy for a single NestJS application. A monorepo adds packages as units and places their category:
```yaml
units:    [ …, { workspace: true, category: package } ]   # every workspace package, named by its manifest
floors:   [ [category: package], … ]                      # a new package takes this floor at birth
entries:  [ …, { manifest: exports } ]                     # a package's entries are its manifest's exports
declared: manifest                                         # a package imports only packages its manifest declares
```
runlith's server policy is `units: [{ select: "apps/tagma/server/src/{unit}/" }]`, `inner: { "*": [contract/wire/] }` and the 27 floors of [[f49f228f]] by unit name.

**Placement is deterministic:**
- Unit selectors are ordered; the first that captures a path owns it. Two selectors producing one unit id, or a capture that yields an empty id, are refused at decoding.
- A unit takes the floor of the entry naming it; an explicit unit name beats its category; a unit or a category on two floors is refused at decoding (today's rule for entries, [[b960a47c]]).
- A unit no floor names takes `unplaced`: `top` — it may import every placed unit and no placed unit may import it; `refuse` — each of its files is a violation until placed; `out` — deliberately out of coverage, shown as such in every reading. It is never silently unmeasured.
- `inner` orders paths inside one unit; an import between two units is judged by the project floors and the target's entries, whatever the inner order.
- Entry patterns are relative to the target unit's directory, and `manifest: exports` applies to package units. Entries are ordered; the first entry matching a target path decides it, and where entries are declared a target path no entry matches is private to its unit. With no entries declared, a unit is open whole. Two entries with one pattern and different roles are refused at decoding. Entries apply to imports across units, same floor included.
- `unresolved` is its own choice, independent of coverage and of the closed mode: `refuse` makes an import that aims inside the region and resolves to nothing a violation, as [[083d37f1]] does today; `unjudged` names it beside the verdict. An import outside every declared, supported resolution stays visible as unjudged.
- `coverage: refuse` and a closed `relations` list are independent choices: a project may demand that every file belongs to a unit and still allow every downward relation.

**Tightening and loosening:**
- A new unit matching an existing selector writes nothing.
- Moving a unit to another floor or category, or changing `unplaced`, is a policy change. It is a tightening only when core logic proves every old violation still stands — for example, with `siblings: allow`, moving a unit from its category's floor to a floor of its own below it forbids its imports into its former siblings and permits nothing new. Moving a `top` unit onto a floor permits imports into it that were refused, so it is a loosening and asks.
- Adding a prohibition or an entry restriction is a tightening; removing one, or widening an entry, is a loosening.

**Separate norms:** independently changeable obligations stay separate #rules even when one `boundaries` check measures them — for runlith: the server's order, the server's entries, the packages' law, and each kept prohibition.

**Fingerprints:** a floor crossing keeps `<file> -> <entry>` ([[b0921843]]) where the violation unit is the same; an entry or prohibition violation is `<file> -> <target unit>:<entry or prohibition>`; a cycle is the sorted unit set with the file that closes it. A new unit model migrates debt through an adoption act ([[d11108eb]] §4.4), never by claiming byte-equal identity.

### 4.2 What replaces the 589 relations

The model: the server's order and inner floors with the entries `contract/**` and `testing/**`; packages by `workspace`, `declared: manifest` and `manifest: exports`; `unresolved: refuse` kept as it stands; cycles on real imports; prohibitions where the order is too permissive for a stated reason. The conversion itself — the semantic delta the operator approves once, and the debt — is [[cdf2a89f]]'s.

### 4.3 `loads` and `platforms`

They stay in the `js` pack: each reads a transitive closure from every start, which `boundaries` does not. `platforms.built` becomes a parameter list of package names.

### 4.4 `size`

A generic evaluator in the `architecture` pack that never parses: the language adapter supplies a per-file metric (`lines` and `importLines` exist in `@runlith/code-facts` today), and `size` applies a threshold per glob and the value ratchet. A file with no metric is unsupported, never zero. Tagma ships no threshold; the project chooses it.

### 4.5 Reverse impact

A change of a manifest's dependencies or `exports`, of resolver configuration, a deleted target, an added file that shadows a resolution, or a changed alias can make an unchanged importer violate. The judgement widens its selection to the importers the change reaches, through a reverse-import index per tree, and falls back to a measured full reading of the affected region where the index lacks knowledge. A rule whose fallback does not fit a landing stays at watch or merge. The index ships only with a test proving equality with a full reading on fixtures, and its loss changes latency, not verdicts. Until it ships, every rule states [[550755a6]]'s limit; nothing claims it is fixed.

## 5. Owners and boundaries

The `architecture` pack owns `boundaries` and `size`, their decoding, their tightening proofs and their fingerprints; `@runlith/code-facts` owns imports, resolution, manifests and metrics; `enforcement/` owns the selection with reverse impact.

## 6. Rejected alternatives

- **A closed allow-list as the default**: [[9140c692]] M1–M2.
- **`unplaced: top` followed by a "proven" placement**: placing a `top` unit lower permits refused imports; floors are assigned at birth by category instead.
- **Units as #module blocks or `depends-on` edges**: the law would depend on the documentation being complete, and the hand-drawn copy already rotted ([[b29472e3]]).
- **Cycles checked on the declared table**: a table with no cycle says nothing about imports when siblings are allowed.
- **Glob specificity deciding overlaps**: implementation-dependent; ordered first-match with refused contradictions is deterministic.

## 7. Acceptance criteria

- In a fixture, a new feature under an existing category, a new unit matching a selector and a new package land with zero policy writes; an upward import refuses; a cycle between sibling units refuses from real imports.
- Two selectors capturing one unit id, a unit on two floors, and two entries with one pattern and different roles are refused at decoding.
- `unplaced: out` shows in `read_inspections` and in `check_rules` as uncovered.
- With `unresolved: refuse`, an import aiming inside the region at a path the tree does not hold refuses, as under `modules` today.
- A change to a package's `exports` that makes an unchanged importer cross is refused at the landing that changes it; the incremental reading equals the full reading on fixtures.
- `boundaries` reproduces the verdicts of [[f49f228f]], [[94d54cd1]], [[39817e41]] and [[fd247128]] at HEAD with their debt.
- `size` over runlith's region reports the same files and values as [[6b3210c7]]'s adopted baseline.

## 8. What becomes of the claims and tasks it touches

- Area [[3abaa819]] and its claims ([[59cbc87e]], [[b0921843]], [[ec084c0c]], [[b960a47c]], [[8e80d41b]], [[27eba453]]): closed into claims written from `boundaries` when `direction` retires.
- Claim [[bda82183]]: rewritten for `boundaries`' proofs.
- Claim [[3d74c6df]] and task [[4fe9507f]]: the `built` mapping moves into `boundaries`.
- Area [[f5525c8a]] and claim [[550755a6]]: revised when reverse impact lands.
- Rules [[f49f228f]] and [[94d54cd1]]: the sentence asking to place each new top-level directory through `enforce_rule` goes once their policy uses a selector and a declared `unplaced`.

## 9. Order of building

`size` first (it only reads a metric); then `boundaries` with selectors, floors, entries, prohibitions and cycles on imports; then reverse impact; then the conversions of [[cdf2a89f]].

## Spec-list questions

This decision answers 1–9.
- 10 Contract: `boundaries` and `size` are new builtin ids with their schemas; `direction` and `modules` stay readable until every rule on them is re-adopted.
- 12 Who may do what: placement changes follow the tightening proof; everything else asks the operator.
- 14 Bounded resources: a landing reads the changed paths, their units' manifests and the reverse-impact set; a whole-region fallback is measured at adoption and placed at merge or watch when it does not fit.
- 16 Failures: an unresolved import is a violation or `unjudged` as the policy's `unresolved` says; an unparsable built file fails the reading, as today ([[1f9f1418]]).
- 17 Observability: `read_inspections` shows each unit's floor, its selector and the uncovered paths.
- out: 11, 13, 15 — the builtins store nothing beyond the policy and the ledger of [[172759d0]], hold nothing long-lived, and roll out rule by rule through [[cdf2a89f]].
