---
id: 01a102c9-d21b-7e1b-8a75-ee574656ab6f
title: enforce_rule silently drops the new builtin parameter and answers success
ord: 9
tags: ["reflection"]
fields:
  {
    "actual": "status ok, but framework is missing from the returned inspection, revision is still b9d37bee236f, retired [], debt.before and debt.after hold all 5 records. The source CLI inspection with framework on the pinned tree 38cedf42 checked 4233 files and removed only two $app violations; the server was not restarted.",
    "command": "tagma op enforce_rule for 083d37f1, base b9d37bee236f, builtin modules with framework: [\"$app/*\"] at HEAD 47dc1aa6e5606cdc85e306f28c78c6e5b83e8175",
    "expected": "Persist framework and measure the current implementation from HEAD: two $app violations disappear, three window-behavior violations stay; if the loaded schema does not know the parameter, return an explicit refusal."
  }
---
Filed from project `runlith`.
