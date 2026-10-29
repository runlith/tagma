---
id: 01a156ee-85b8-7fb5-ad25-ad0590e3a1c9
title: "Enforcement document carries the inspection key: `enforce_rule`/`check_rules` by key from `Config`, judgement by the commit version's description, graph step"
ord: 7
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15755-d9fc-7148-bba5-ae537a1a1c94",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a156d9-a73e-7045-bbfd-b087b6f7a4e0
  - kind: waits-on
    to: 01a156ec-eded-78fd-a9ab-b0d145445f10
  - kind: waits-on
    to: 01a156ee-85b8-7fb5-ad25-ad048f8b4683
---
The "Graph holds the law, code holds the inspection" section [[b6f7a4e0]]:
- document shape `{ strictness, on, inspection: <key>, debt, escaped }`;
- `enforce_rule.inspection` is a string resolved in the HEAD `Config`, otherwise the `inspection-unknown` refusal; `patch` and `{ bindings }` go away;
- `check_rules.inspection` is a key from the `Config` of the change version;
- both sides are judged by the commit version's description; the description's canonical form enters the measurement identity; no key in the version means `inspection-failed`;
- a graph step in `graph/steps/` that outputs keys and rewrites program fingerprints;
- builtin inspections through `Config`.

Depends on the `config` module [[45445f10]] and on the renames [[8f8b4683]].

Proof is acceptance items 2–4 of [[b6f7a4e0]] (integration).
