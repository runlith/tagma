---
id: 01a16901-2d10-7056-b1ee-7af9541daf8e
title: "A linter inspection's config reads from the shared working tree: a neighbor's uncommitted edit judges other people's landings"
ord: 12
tags: ["reflection"]
fields:
  {
    "actual": "Adapters read config from the checkout's disk (filesRunner.ts checkerConfig, oxlint.ts configOf, eslint.ts envOf → the import(config) driver); ruff/semgrep/ast-grep get --config on a working-tree path, ast-grep reads ruleDirs from disk — a landing is judged by the neighbor's uncommitted config.",
    "command": "check_rules / submit_work over a rule with a Linters.eslint|oxlint|ruff|semgrep|astGrep({ config }) inspection, while another session holds an uncommitted edit of that config file",
    "expected": "The linter judges the change with the judged tree's config, like the project's programs after 50f3baec: someone else's uncommitted config edit takes no part in the judgment."
  }
edges:
  - kind: discovered-from
    to: 01a14128-56ed-7f74-b96f-915450f3baec
---
Filed from project `runlith`.

Found while working on [[50f3baec]] (the project's programs already judge with the judged tree's code, commit 6f55ac8c31); the same defect class as [[664d80e9]].
