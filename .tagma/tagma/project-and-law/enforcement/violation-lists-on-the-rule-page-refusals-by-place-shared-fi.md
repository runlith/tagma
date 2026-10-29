---
id: 01a15a8d-6750-7ee2-8532-e76f4824f92a
title: "Violation lists on the rule page: refusals by place, shared fix once, compact table for refusals, debt and escapes"
ord: 64
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15a84-795a-7d9d-a265-2c12ba8db0e1",
    "status": "done"
  }
---
On the [[083d37f1]] rule page in runlith, 1160 refusals run as a solid ribbon, each record repeats the shared `Imports.modules` escape as its own "Fix", records before [[b495071b]] carry the import instead of the check phrase, a "landing by an agent on main" meta stands under every line, and path and import are cut at the edge.

What to do:
- **Server (enforcement).** The function-shared escape is given once per rule (`engine`, `norm`), a finding, refusal and escape carry only their own `fix`. `findingLines` prints the shared escape once above norm violations that have none of their own; the `read_enforcement` voice does the same. A refusal keeps its own check phrase apart from the import, which records before [[b495071b]] kept in the same column. `read_enforcement` returns refusals by place (fingerprint): a place's last refusal, its count and its first time, paged newest-first — grouped by the server.
- **Screen.** One shared list component for refusals, debt and escapes: a row is time, `file:line` with a left fade, point, repeat count; expansion is the full point, its own fix, who/where/branch/commit. The rule's shared escape stands once above the list.
- The `rules` skill per [[de8d5a75]].

Proof: a live `tagma:try` with a project of hundreds of refusals and rule-page frames; an itest on refusal grouping in `read_enforcement`; typecheck, enforcement tests.

Done in 07daa00c4b and d9cf653271. Not proved: the latest debt-list view on a checkout where the rule is measured (a place from a measurement shows only in the itest; the fixture had no measurement), and the migration step carrying refusal phrases recorded between b495071b and this work, checked by hand on a table copy, not by test.
