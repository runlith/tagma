---
id: 01a0f476-051e-7c46-aa9a-b63cf697d121
title: "The rules agent turns an operator's intent into adopted law in any project: what a NestJS shop and a Python service do, file by file"
ord: 8
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
Part of [[9140c692]]. It fixes what a user of any project does to get architecture law, file by file, and what the `rules` agent ([[26598301]]) does and asks — shown for a NestJS shop and a Python service.

## 1. Outcome

- The operator states intent in words; the `rules` agent reads the tree, measures candidate checks with `check_rules`, proposes with measured figures, writes the #rules, `checks/` files and owner tasks, and runs `enforce_rule` on the operator's word.
- Feature agents write code only; the law reaches them in their region before they write.
- The agent tells the operator plainly what Tagma cannot yet read for the project's language and offers the interim checker.
- For a conversion that removes restrictions, the agent presents the semantic delta grouped by meaning for one approval, never a list of pairs.

## 2. Problem, with evidence

The agent's prompt carries the engine's model and reads its catalog at run time ([[14725e18]]), but the catalog offers only builtins and a single-program road, so for a non-JavaScript project the agent has nothing to propose but a hand-written program; and it has no method for a loosening conversion like [[083d37f1]]'s.

## 3. What holds now

The builtin `rules` agent measures with `check_rules` over unsaved inspections, proposes and enforces on the operator's word ([[26598301]]); its prompt names the programs directory's role, not its name.

## 4. Target model

### 4.1 A NestJS shop (team storage, oxlint for style)

Tree: `src/modules/{orders,payments,catalog,users}/` with `*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/`, `entities/`; `src/common/`; `src/infra/{db,queue}/`.
1. The operator adds the project; `.tagma/` appears in the repository. Nothing is adopted.
2. The operator tells the `rules` agent: "features above infra, infra above common; a module never reaches another's entities; a controller never touches the database".
3. The agent reads the tree, `package.json`, `tsconfig.json`, `.oxlintrc.json` and `read_inspections` (packs `architecture`, `js`; the adapters and their capabilities), and measures unsaved checks with `check_rules over: all`:
   - A, the order: `boundaries` with the selectors and floors of [[bedb212a]] §4.1's example, `siblings: allow`, `cycles: refuse`;
   - B, the entries: `*.module.ts`, `*.service.ts`, `dto/**`;
   - C, the prohibition `**/*.controller.ts` → `src/infra/db/**`.
4. It answers one line per rule: what stands now, the proposed strictness (watch first), the owner tasks it would open, and the measured cost.
5. The operator: "A and B at gate before submit_work and merge, C at watch; open the tasks." The agent writes three #rules under the #module (or project root) whose region they govern, opens the owner tasks, and runs `enforce_rule` with owners. The pull request shows the rules' `.tagma/…` files with their policy and debt.
6. A per-file rule — "no `@Injectable()` class inside `controllers/`": the agent writes `checks/lint/shop.ts` (an oxlint JS plugin with one rule), `checks/law.oxlintrc.json` (only the law's rules) and a descriptor in `checks/runners.json`:
   `{ "id": "law-oxlint", "adapter": "oxlint", "config": "checks/law.oxlintrc.json", "pins": ["checks/lint/**"], "packages": ["oxlint"], "runtime": "node" }`.
   It measures, and on the operator's word adopts D with `checks: [{ runner: "law-oxlint", id: "shop/injectable-in-controller" }]`; the confirmation names the pinned closure.
7. Daily: an agent editing `src/modules/orders/` receives A–D on its first touch. A new `src/modules/invoices/` takes the feature floor at birth; importing `payments/payments.service.ts` is a legal entry; importing `payments/entities/payment.entity.ts` refuses `rule-violated` at `submit_work` with the site and the unblock words; D is judged by one oxlint run over both sides.
8. CI runs `tagma check` with its base revision named, judging pull requests made outside Tagma by the same accepted law.
9. Later: "invoices below orders" is a proven tightening under `siblings: allow` and writes without a question; "orders may read users' entities" is an allowance — a decision, then the operator's word; an oxlint upgrade leaves D `pending re-adoption` while the gate keeps the accepted version, and the agent proposes the re-adoption with its measurement.

### 4.2 A Python service (`billing/`: `src/billing/{domain,app,adapters,api}/`, ruff, pytest)

1. Same start. Until the Python adapter ships, `read_inspections` answers `languages: js`, and the agent says `boundaries` cannot read Python yet.
2. Interim per-file law through ast-grep: `checks/ast-grep/sgconfig.yml` and `checks/ast-grep/rules/domain-imports.yml` ("under `src/billing/domain/**`, no `from billing.api`, `from billing.adapters`, `import billing.api`"), a descriptor `{ "id": "law-sg", "adapter": "ast-grep", "config": "checks/ast-grep/sgconfig.yml", "pins": ["checks/ast-grep/**"], "packages": ["ast-grep-cli"] }` (the package as the service's `uv.lock` pins it), one run over both sides. Stated limit: relative imports (`from ..api import x`) are not resolved.
3. Ruff supports no custom rules; any of its built-in rules the operator wants under law runs as the `ruff` adapter with `--ignore-noqa`; a rule with no locator gates only as an adopted count budget.
4. For layers, `import-linter` wrapped as a contract 2 program (`tree` layout) is the other interim, placed at merge.
5. When the Python adapter ships, the agent proposes `boundaries` (`units: [{ select: "src/billing/{unit}/" }]`, floors `[[domain], [app], [adapters], [api]]`), moves the debt by an adoption act, and retires the interim rule through `enforce_rule` — a loosening of that rule, covered by the new one, so it asks.

### 4.3 Who writes what

- Operator: intent, strictness, loosenings, the trust root.
- `rules` agent: #rules, `checks/` files and descriptors, owner tasks, `enforce_rule` on the operator's word.
- Feature agents: code.
- People: review `.tagma/` and `checks/` beside the code.

### 4.4 What the agent learns

Its prompt gains, as method rather than catalog: runner descriptors and one run per identity; reading adapters' capabilities from `read_inspections`; placement by category at birth; the semantic delta for a conversion that removes restrictions; and that a language Tagma cannot read is said so, with the interim checker offered.

## 5. Owners and boundaries

The agent definition under `native-harness/agents/rules/` owns the method; `read_inspections` owns the catalog it reads; nothing in the agent's prompt names a builtin's parameters ([[14725e18]] holds).

## 6. Rejected alternatives

- **A proposal per detected pair** for a conversion: 354 questions nobody can judge (M1); grouping by meaning makes one decision.
- **Adopting at gate first**: watch first surfaces false positives before anything refuses ([[bb03ddd5]]).

## 7. Acceptance criteria

- A live run in a NestJS fixture with no rules produces a proposal whose every figure came from a `check_rules` call in its transcript, and writes nothing before the operator's word.
- Told to enable, it writes the #rules, the `checks/` files and the descriptor, and adopts with owners exactly as proposed.
- In a Python fixture it states that `boundaries` cannot read Python yet and proposes the ast-grep interim.

## 8. What becomes of the claims and tasks it touches

Claim [[14725e18]] is rewritten from the new prompt; decision [[26598301]] stands.

## 9. Order of building

The prompt changes land with each capability they describe: descriptors with [[d11108eb]], placement with [[bedb212a]], the semantic delta before the conversion of [[083d37f1]].

## Spec-list questions

This decision answers 1–9.
- 12 Who may do what: the agent enables only on the operator's word; loosenings ask under trust by the enforcement floor ([[5134ddcf]]).
- 17 Observability: its thread shows every measurement and proposal.
- out: 10, 11, 13–16 — a prompt adds no contract, state, lifetime, resource, rollout or failure of its own.
