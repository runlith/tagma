---
id: 01a1591f-c1f6-7eeb-98cd-958ff7de222a
title: check_rules over all on the polygon rule from a runlith thread refuses terminal-foreign-project
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "Rule `failed after 0.0 s: checker tools/programs.ts was not admitted: terminal-foreign-project`, yet the answer prints `no violation`",
    "command": "check_rules { over: \"all\", project: \"polygon\", rules: [\"56e875f1\"] } from a thread with home runlith (project 5)",
    "expected": "Measure the polygon rule float over HEAD 2aba76b45d with a violations answer"
  }
---
Filed from project `runlith`.

One-action workaround: the Tagma runner was started by hand over the polygon HEAD with the `float` key, `findings: []`. An answer reading "no violation" next to a failed rule looks like success, though no measurement happened.
