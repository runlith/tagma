---
id: 01a0f476-0517-7e14-868b-9081b29472e3
title: On the graph the law is norms, reach, adoption, provenance, debt owners and the intentional policy, a linter rule's options included; import edges, the derived unit territories and entry inventories and measured facts are never stored there
ord: 7
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
Part of [[9140c692]]. It answers the operator's question of how the law layer sits on the graph: what the graph carries that files alone cannot, what it links without copying, and what it must never hold.

## 1. Outcome

- The graph holds the law's **norms, their reach, their adoption, their provenance and their debt owners**.
- It links checker files and claims to rules without copying their content.
- It stores the intentional policy — selectors, floors, entry restrictions, prohibitions, allowances, and the options of every linter rule it binds — on the rule, and never what is derived: import edges, the unit territories and entry inventories that selectors and manifests expand to, tool versions, or measured violations beyond debt and escapes.

## 2. Problem, with evidence

- `depends-on` edges between #module blocks were hand-drawn copies of imports, measured only by the doctor; the map was already wrong (agent-tools → git missing) and they were removed in `18a488d6d1`.
- [[083d37f1]]'s territories and entries copied restructure cards, and its package half copies manifests ([[9140c692]] M2).
- Rule documents grew to 127 KB inside graph files and were copied by hand into `checks/*.json`, where they drifted.

## 3. What holds now

A #rule rides the prompt of every thread in its reach as title and body only; its enforcement document never does ([[1e43220d]]). The #module tag already says what a module may import is law in the rules that govern it.

## 4. Target model

**In the graph, because only the graph gives it:**
- the #rule's norm and its **place**: its region — the nearest ancestor carrying no law — and every live block under it hold, in their dir and file sources within the base, the rule's reach ([[feab0c98]]); one reach serves delivery and judgement alike, deciding which agents receive the rule on their first touch and which paths the gate measures;
- **lifecycle guards**: the operation-only field, and `rule-enforced` refusals for disabling, superseding, trashing or moving an adopted rule; a reach narrowed through the region's or a descendant's sources is caught as pending by [[172759d0]];
- **provenance**: a rule relates to the decision that accepted it; a loosening's `unblock` asks for a decision; the journal keeps every accepted revision;
- **debt owners**: each debt entry names an open debt owner as enforcement's predicate module answers it — today an open #task or #decision by their `work` and `decision` roles, after [[877ba8f0]] any type carrying work or a promise in a non-terminal state ([[172759d0]] §4.2); a closed owner with standing debt is a finding;
- **permission**: loosening is its own subject;
- the policy, the adoption record and the ledger, as fields of the rule ([[172759d0]]).

**Linked, not copied:**
- a rule's checker files appear as its `file` sources, so the doctor shows a rule whose checker moved;
- a claim may cite a rule as a `node` source, as [[3315b329]] cites [[50520d64]]; a claim attests an implemented guarantee, never that a config holds a number.

**Never in the graph:**
- import edges and measured dependencies;
- the unit territories and entry inventories that selectors and manifests expand to — the selectors and restrictions themselves are policy;
- tool versions (the lockfile);
- violations beyond debt and escapes, and time series (recomputed or kept in the enforcement store);
- units as #module blocks: the law's units come from selectors and manifests, the graph's modules are drawn by meaning, and `read_owners` joins a path to both. The `core/territory` contract of [[14e01b12]] states a module's territory for documentation ownership — `read_owners` and the doctor's territory findings — and is never read as the law's units.

The map may draw a measured dependency overlay labelled with its tree and its unknowns; it is a reading, never stored truth.

## 5. Owners and boundaries

The graph owns norms, placement, lifecycle, provenance and owners; `enforcement/` owns the rule's law fields; the code and its manifests own every fact.

## 6. Rejected alternatives

- **`depends-on` or #module blocks as the law's units**: couples law to documentation completeness; it rotted once.
- **A block per checker function or per debt entry**: a rule's check is data on its policy; a large ledger is paged, not split into blocks.
- **Linter options in the linter's own config**: the rule and the config would be two homes of one norm's settings; the binding's params are the only home, and the adapter writes the linter's config from them for each run.

## 7. Acceptance criteria

- Adding a unit, an import or a package changes no graph block.
- Every debt owner resolves to an open owner through the predicate module, and closing an owner with standing debt raises a finding.
- A rule's prompt delivery stays title and body.

## 8. What becomes of the claims and tasks it touches

None changes; [[1e43220d]] stands.

## 9. Order of building

Nothing is built for this decision alone; its constraints bind [[172759d0]], [[bedb212a]] and [[d11108eb]].

## Spec-list questions

This decision answers 1–9.
- 12 Who may do what: lifting an adopted rule by any graph road refuses; [[172759d0]] holds the rest.
- out: 10, 11, 13–17 — this decision places data and adds no contract, storage, lifetime, resource, rollout, failure or signal beyond those of the children it binds.
