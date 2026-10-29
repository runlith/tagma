---
id: 01a15a07-0f20-73b3-9467-0ac5ad7a0293
title: "A custom tag-rule in the user's catalogue joins the Rules screen and is judged at commit like a #rule"
ord: 19
tags: ["experiment"]
fields:
  {
    "status": "planned"
  }
---
## Hypothesis

A law-lab tag other than `#rule`, with `law`, `delivery` (enum `prompt`/`code`) and `enforcement` roles, is delivered to agents, shows in the Rules list and becomes a check through `enforce_rule` with strictness, debt and commit refusal — without a single Tagma edit.

## When

After the current work lands: the violation view (b495071b), the Rules screen (f4e52ddd), cross-project edges (4476383d) and the `rules` skill. The already built product is checked.

## Grounds

By the code: the server recognizes a rule via `table.lawProjection(row)` (`enforcement/rules/predicate.ts`), the app via the `enforcement` role (`TagCatalog.enforced`); the tag name is never compared. Not checked live.
