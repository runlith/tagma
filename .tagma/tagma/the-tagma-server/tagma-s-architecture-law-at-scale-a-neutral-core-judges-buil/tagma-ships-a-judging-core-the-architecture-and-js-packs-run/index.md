---
id: 01a0f476-04d1-75cd-af52-c567fd53d2cb
title: Tagma ships a judging core, the `architecture` and `js` packs, runner adapters and the facts kit, and no rule of any project or library; a project's own rule is a linter rule or a program in its checks directory
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
Part of [[9140c692]]. It fixes who ships which part of the law layer, where each part runs, and how a project adds a rule of its own without a Tagma release.

## 1. Outcome

- Tagma ships five parts and nothing else in the law layer: the core, the `architecture` pack, the `js` pack, the runner adapters and the facts kit.
- A project's own rules live in the project: norms in its graph, checks as linter rules or programs in its declared checks directory, run by the adapters.
- The packs `effect` and `tagma` and every rule written for one project leave Tagma.

## 2. Problem, with evidence

See [[9140c692]] §3, M4 and M5: four shipped builtins carry no rule; shipped schemas name runlith's packages and modules; the graph's codec can decode only builtins compiled into Tagma, so every new rule is a release.

## 3. What holds now

`apps/tagma/inspection/src/builtins.ts` composes the packs `typescript`, `effect`, `repository` and `tagma` statically. `usedPacks` only detects which packs a tree's manifests call for; `ready` loads a pack's readings on its rule's first judgement, and a stored rule is judged whatever the tree uses ([[c0f6787c]]). A project reaches beyond the builtins only through a program run on the command road as the caller ([[50467aad]]).

## 4. Target model

| Part | Owns | Lives in | Shipped and loaded by | Runs |
|---|---|---|---|---|
| **Core** | the judgement, the key and value arithmetic, proven renames, the ledger, strictness × triggers, the runner contract and its decoding (SARIF, contract 2), the group planner, checker identity, adoption and the trusted predecessor, the policy codec | `@tagma/inspection/core`, the server's `enforcement/` | Tagma | the server, as pure code |
| **`architecture` pack** | `boundaries` and `size` ([[bedb212a]]), over facts; no parsing in the builtin itself | `@tagma/inspection/packs/architecture` | Tagma, always | the server's inspection workers |
| **`js` pack** | `loads` and `platforms`, which need npm manifests and `exports` maps | `@tagma/inspection/packs/js` (today `typescript`) | Tagma, loaded when the tree uses the ecosystem | the workers |
| **Runner adapters** | per external checker: running a subset of check ids over a set of inputs, its layout, decoding its output, its exit-code meaning, its suppression grammar, how its identity is read | `@tagma/inspection/runners/<tool>`: `sarif`, `program`, `oxlint`, `eslint`, `ruff`, `ast-grep`, `semgrep`, then `golangci-lint`, `clippy` | Tagma — integration only, no rule content | adapter logic in the server; the checker's process on the execution host as the triggering caller |
| **Facts** | imports, resolution, manifests, declarations and file metrics per language, behind declared capabilities ([[3f3fe425]]) | `@runlith/code-facts` | Tagma | the workers |
| **Project checks** | norms; builtin parameters; linter rules and linter config for law; programs; runner descriptors ([[d11108eb]]) | the project's graph, its declared checks directory, the checker's own config | the project | the execution host, as the caller |

- **A project's own fast rule** is written in the checker its language already has — an oxlint JS plugin rule in TypeScript, an ast-grep or semgrep YAML rule, a Go analyzer through golangci module plugins, a lint through dylint — or, when it needs cross-file facts, a program in the checks directory. The #rule's policy references it; nothing is compiled into Tagma.
- **No project byte runs in the shared server process.** Worker threads are no authority boundary, so they run only Tagma's first-party code. A third-party pack (long-term) is a manifest with files, run on the caller's road.
- **`tightens` is proven only by logic the core knows** — today's proofs of `direction`, `loads` and `reexports`, carried into `boundaries`. A change it cannot prove asks the operator.
- **Installing a pack or an adapter offers checks and adopts none** ([[b9bdfa95]] holds). A project that adopted nothing starts no process and no parser at a commit.
- **Neutrality test:** two projects with contradicting policies judge on one binary with no code change.

## 5. Owners and boundaries

- `@tagma/inspection` owns the core's pure half, the two packs and the adapters' decoding; it reaches no server, store or process ([[6c3e3c67]] holds).
- The server's `enforcement/` owns planning, identity, adoption, the ledger's writes and the run on the command road through its port.
- `@runlith/code-facts` owns facts and stays free of rules.
- The tag model's `core` vocabulary library ([[3087c3ed]]) takes the name once the `tagma` inspection pack is deleted ([[cdf2a89f]] step 6).
- A project owns its checks directory, its linter configs and its programs.

## 6. Rejected alternatives

- **Library and product packs inside Tagma** (`effect`, `tagma`): they are one project's opinions compiled into every installation.
- **Loading a project's plugin into the server**: one project's code with the server's authority, and one crash for every project ([[50467aad]]).
- **A public SDK package**: [[833122ed]] rejected it; the facts snapshot of contract 2 saves the real duplicated work, which is parsing.

## 7. Acceptance criteria

- A source audit of the core and the first-party packs finds no project-specific policy enum, selector, default, diagnostic or unblock wording, or rule implementation; the kits the layer imports by design, such as `@runlith/code-facts`, are not findings.
- Two conformance fixtures of unrelated projects, with contradicting policies, judge correctly on one binary.
- A rule referencing an oxlint plugin rule of a fixture project is adopted and judges with no Tagma release.
- `catalogOf` composes no `effect` or `tagma` pack.

## 8. What becomes of the claims and tasks it touches

- Area [[506295c4]] and claims [[e0435a03]], [[c0f6787c]]: rewritten from the code for the packs `architecture` and `js` and the adapters.
- Claims [[3315b329]] and [[6c3e3c67]] (drifted): re-read and rewritten from the code that lands.
- Rule [[6f758080]]: its example changes as [[9140c692]] §7 says.

## 9. Order of building

The policy codec without the builtin union first ([[172759d0]]), then the adapters' contract ([[d11108eb]]), then the removals ([[cdf2a89f]]).

## Spec-list questions

This decision answers 1–9.
- 10 Contract: the policy's check reference becomes `builtin | runner`, decoded without a compiled union ([[172759d0]] holds the version).
- 12 Who may do what: only core logic proves a tightening.
- 14 Bounded resources: a project that adopted nothing pays nothing at a commit.
- out: 11, 13, 15, 16, 17 — this decision places code and adds no state, lifetime or failure of its own; the children that add them answer them.
