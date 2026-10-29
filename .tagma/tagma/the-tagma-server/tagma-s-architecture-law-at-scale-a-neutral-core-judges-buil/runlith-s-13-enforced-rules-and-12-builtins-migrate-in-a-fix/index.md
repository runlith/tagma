---
id: 01a0f476-0526-7928-a1ce-c58bcdf2a89f
title: runlith's 13 enforced rules and 12 builtins migrate in a fixed order, and each old gate retires only after its replacement judges the same
ord: 9
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
Part of [[9140c692]]. It fixes what becomes of each of runlith's enforced rules and each shipped builtin, and the order of the work. Every old gate retires only after its replacement is proven to judge the same; removing code no rule uses changes no law in force.

## 1. Outcome

- The four unused builtins, the `effect` and `tagma` packs and the `checks/*.json` copies are gone from Tagma and runlith.
- `reexports`, `swallowed-failures` and `call-services` leave Tagma: first as one runlith program moved verbatim, then — planned, not optional — `reexports` and `swallowed-failures` as oxlint plugin rules with Svelte covered by a second runner.
- `names` dissolves: F4 becomes `size`; the rest of the doctrine leaves Tagma.
- `direction` and `modules` fold into `boundaries`; [[083d37f1]]'s relation list is replaced after one approved semantic delta.

## 2. Problem, with evidence

[[9140c692]] M1–M6 and M8.

## 3. What holds now

The 13 enforced rules, their checks and their debt on 2026-09-30:

| Rule | Check | Debt |
|---|---|---|
| [[f49f228f]] server floors | `direction` | 0 |
| [[94d54cd1]] agent floors | `direction` | 0 |
| [[39817e41]] code-facts `languages/` | `direction` | 0 |
| [[fd247128]] llm vendor profiles | `direction` | 0 |
| [[083d37f1]] modules | `modules` | 3, owned by [[4fe9507f]] |
| [[0d2c66a9]] low floors load no model client | `loads` | 0 |
| [[925aed1c]] code-facts core loads no parser | `loads` | 0 |
| [[50520d64]] platforms | `platforms` | 1 |
| [[8183e6ef]] no re-exports | `reexports` | 0 |
| [[ea465bed]] no swallowed failures | `swallowed-failures`, 259 allowances | 0 |
| [[4657a163]] only invocation assembles call services | `call-services` | 0 |
| [[6b3210c7]] 650 non-import lines | `names` F4 | 36 with values |
| [[99b5c911]] browser bundle | program `bun checks/browserBuild.ts`, watch after merge, about 45 s | 0 |

## 4. Target model

### 4.1 Builtins

| Builtin | Fate |
|---|---|
| `direction` | folds into `boundaries`; explicit file floors ([[94d54cd1]], [[39817e41]], [[fd247128]]) stay explicit |
| `modules` | replaced by `boundaries` rules (4.3), then deleted |
| `loads`, `platforms` | stay in the `js` pack; `platforms.built` becomes a parameter list |
| `reexports`, `swallowed-failures`, `call-services` | **now:** moved verbatim into runlith's `checks/law/` as one contract 2 program on the `runlith-law` descriptor — same algorithm, same fingerprints, the same `.svelte` reading and import-binding resolution; it may import `@runlith/code-facts`, which is runlith's to use. Parity is proven by integration — the verdicts at HEAD and on a mutation corpus, reach, values — not assumed from the copy. **Next (the planned destination):** `reexports` and `swallowed-failures` become rules of a runlith oxlint plugin with a parity corpus, and `.svelte` is covered by the same rules run through ESLint with the Svelte parser on a `law-svelte` descriptor — each norm bound to both, as [[d11108eb]] §4.1 shows; `call-services` stays a facts program only if its cross-file tag identity requires it |
| `names` | F4 → `size` ([[bedb212a]] §4.4); F1–F3, F5–F7, S1–S11, literals and the glossary leave Tagma; they return as runlith linter rules or facts programs only if the operator enforces [[931cfbf1]] or [[8d3638ce]]. The check that the graph core names no catalog tag ([[6bf40362]] §7, [[e04cfdcb]] §8.6), today `names`' `literals` parameter, becomes a runlith check in `checks/` — an oxlint rule over tag positions — adopted when the operator enforces it |
| `held-resources`, `blocking-calls`, `answer-declared`, `operations-registered` | deleted with their `checks/*.json`, `checks/*.debt.json` and the `bench:*` scripts of `apps/tagma/inspection/package.json`; git history keeps them |
| packs `effect`, `tagma` | deleted from Tagma |

### 4.2 The enforced rules

- [[f49f228f]]: `boundaries` with `units: [{ select: "apps/tagma/server/src/{unit}/" }]`, `inner: { "*": [contract/wire/] }`, the same 27 floors, and an `unplaced` the operator chooses; its body loses the sentence asking to place each new directory through `enforce_rule`.
- [[94d54cd1]], [[39817e41]], [[fd247128]]: `boundaries` with their explicit floors; debt 0 carried.
- [[083d37f1]]: 4.3.
- [[0d2c66a9]], [[925aed1c]]: unchanged.
- [[50520d64]]: `built` as a parameter list; debt 1 carried.
- [[8183e6ef]], [[4657a163]]: re-adopted on the runlith program; then [[8183e6ef]] on two bindings, `law-oxlint` for scripts and `law-svelte` for `.svelte`.
- [[ea465bed]]: re-adopted on the runlith program with its 259 allowances in the program's parameters on the rule — their one home; when the rule moves to the oxlint plugin, the allowances move into the plugin rule's options and leave the rule. Its body's "The builtin `swallowed-failures` measures this" is rewritten.
- [[6b3210c7]]: `size` with `lines: 650` over the non-import metric; its debt moves by a proven one-to-one map. The 36 entries are the baseline of 2026-09-30; the migration compares against the ledger actually adopted when it runs, since other work may retire entries first.
- [[99b5c911]]: leaves the law layer (operator, 2026-10-01): the guard is a Vite plugin each app's own build mounts (`@runlith/vite-browser-guard`, 0e5f5b6b38), and the rule's enforcement is off.

### 4.3 The conversion of [[083d37f1]]

- Server: the order of [[f49f228f]], the entries `contract/**` and `testing/**`.
- Packages: `workspace`, `declared: manifest`, `manifest: exports`; `unresolved: refuse` stays. Before the old entries are dropped, the migration compares all 511 configured package entries with the manifests' `exports` — only 15 packages were sampled on 2026-09-30 (13 exact, `@runlith/git` 11 of 12, `@runlith/tsconfig` with no entries against 3 exports) — and every mismatch is decided as an entry, a manifest fix or a prohibition.
- **Semantic delta, one approval.** The order permits 354 pairs the table forbids (M1); an absent import at HEAD proves no restriction unneeded. The `rules` agent presents what the conversion removes, grouped by meaning: private internals, composition-only assembly, port fillers of a lower module (`role: port`, 42 entries), test-only surfaces (`testing`, 68), sibling bans, runtime against dev dependencies. `for:` restrictions stronger than a package's `exports` (475 entries carry `for:`) are kept as entries or prohibitions. The operator approves the relaxation once.
- Debt: the 329 non-pattern server doors are debt owned by the wave tasks moving them only where an import the new policy refuses exists at HEAD; a file merely absent from the new entry map is no violation. The three `built` entries of [[4fe9507f]] move with `built` into `boundaries`.
- Several `boundaries` rules replace it: the server's entries, the packages' law, each kept prohibition. Then `modules` is deleted.

### 4.4 Order of work

The re-enforcements of [[083d37f1]] and [[50520d64]] already in flight land first, and each step takes the ledger as it then stands. The steps sit in the one order with the tag model that [[9140c692]] states.

1. Release N, beside the tag model's format marker, readers and refusals only: the version 2 codec as a reader, the predicate module, the code of adoption and the predecessor, the publication re-check ([[172759d0]]); then release N+1 with the migration trust-root act, the first version 2 write.
2. Contract 2 with keys, counts and values for every road; grouping of programs ([[d11108eb]]).
3. Declared checker identity and prepared environments ([[b2965d21]]).
4. The runlith program — verbatim move of the three — parity proven, three rules re-adopted, three builtins removed from Tagma.
5. `size`; [[6b3210c7]] re-adopted; `names` removed.
6. The four unused builtins, the `effect` and `tagma` packs, the `checks/*` copies, `platforms.built` — the `tagma` pack before the tag model's `core` vocabulary library ships (its step 4).
7. The `oxlint` adapter with its conformance suite.
8. Next: `boundaries` with reverse impact; the four `direction` rules folded; the [[083d37f1]] conversion; `modules` and `direction` removed.
9. Next: runlith's per-file rules onto oxlint and ESLint with Svelte, by parity corpus.

## 5. Owners and boundaries

- Tagma's source (`apps/tagma/inspection`, `apps/tagma/server/src/enforcement`, `packages/code-facts`) loses the builtins; runlith's `checks/` gains the program, the plugin and the descriptors.
- The wave tasks own the migrated debt of [[083d37f1]].

## 6. Rejected alternatives

- **Port the Effect rules to oxlint at once**: no parity on aliases or Svelte (M8), and the benchmark plugin only approximates `swallowed-failures`; `call-services` resolves import bindings across files.
- **Leave the verbatim program as the final home**: the operator assigns per-file syntax to the language's linter; the program is a transition with a planned end.
- **Drop the old entries on the sampled evidence**: a sample proves nothing about the other 27 packages.

## 7. Acceptance criteria

- The runlith program judges [[8183e6ef]], [[ea465bed]] and [[4657a163]] at HEAD and on a mutation corpus exactly as the builtins did, `.svelte` included; their debt carries.
- `size` reports the same files and values as [[6b3210c7]]'s adopted ledger at the time of migration.
- After step 6, the source audit of [[fd53d2cb]] §7 finds nothing.
- The [[083d37f1]] conversion lands with the whole-population entry comparison, the operator's one approval of the grouped delta, and debt only where a refused import exists.
- No old gate is removed before its replacement's parity is proven.

## 8. What becomes of the claims and tasks it touches

- Areas [[f812c362]] (`reexports`) and [[3abaa819]] (`direction`) and their claims: closed into claims from the code that replaces them; area [[f5525c8a]] stays.
- Claim [[81ec3142]] (browser build): re-read.
- Rules as 4.2; [[931cfbf1]] and [[8d3638ce]] are marked unmeasured until the operator decides.
- Task [[4fe9507f]] moves to `boundaries`; task [[12f0c2d1]] is unchanged; the wave tasks become owners of [[083d37f1]]'s migrated debt.
- Decision [[243fd181]]: its promise that the `names` builtin holds the naming rules at gate is replaced by 4.1's `names` row, recorded as its divergence.

## 9. Order of building

4.4.

## Spec-list questions

This decision answers 1–9.
- 11 Stored data: each rule's document becomes version 2 at its re-adoption; debt moves by adoption acts; the journal keeps each version 1 document.
- 12 Who may do what: the [[083d37f1]] conversion and every re-adoption that is not a proven tightening ask the operator.
- 15 Rollout: the program and adapters land first, then each rule's re-adoption, then each builtin's removal; running work sees no change of strictness.
- 16 Failures: a re-adoption that does not reproduce the old verdicts is not written.
- 17 Observability: each re-adoption's answer names the debt before and after and the parity evidence.
- out: 10, 13, 14 — contracts, lifetimes and bounds are those of [[d11108eb]], [[b2965d21]] and [[172759d0]].
