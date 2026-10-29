---
id: 01a15652-c9cb-7efd-8c4f-471f7769efcd
title: "check_law takes no project and judges another project's rule by the caller graph: false reach-empty"
ord: 11
tags: ["reflection"]
fields:
  {
    "actual": "refused[reach-empty]: `the region of 18ad9402 draws no code under the repository root` with exits `anchor the region above…`, though the rule has a source",
    "command": "check_law(over=\"all\", blockId=\"18ad9402\", inspection={builtin:\"loads\", params:{base:\"\", from:[\"packages/domain\"], …}}) from a runlith thread; 18ad9402 is a law-lab rule with a packages/domain source",
    "expected": "The court runs in the rule project (as enforce_rule and read_enforcement do with project) and reads law-lab packages/domain"
  }
---
Filed from project `runlith`.

`checkTargets` (`enforcement/judging/check.ts`) takes reach through `reachOf(ask.row, base)` → `Orientation.ruleReach(row.projectId)`, and `law.ruleReachOf` reads it through `ownGraph` — the calling graph, i.e. runlith; the law-lab rule is not there, places are empty. `check_law` has no `project` parameter, so from another home's thread a foreign project's rule cannot be judged at all, and the refusal exits point the wrong way: the rule is already anchored to code. Workaround is `tagma op check_law` with cwd in law-lab.
