---
id: 01a1321c-3702-703b-a1a5-5f0133a6bbbe
title: The prefix probe keeps refusing whole-project inspection after the double charge is fixed
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "An isolated build with max instead of sum still refused both operations: 1968 files/8.9 MiB, probe 229 ms/16 files/0.02 MiB, byte projection 12406.5 ms/MiB over cap. check_rules took 14734 ms wall, of it worker 13904 ms; the inspection failed preflight.",
    "command": "bun ~/.tagma/scratch/01a131f4-910d-701b-be58-3eaae8ab0c6a/calibration-verify.ts ~/.tagma-try/calibration-39326f7d/install/current/bun ~/.tagma-try/calibration-39326f7d/install/current/bin/cli/main.js 34fef8bd b246601c",
    "expected": "A separate tagma:try measures whole-project swallowed-failures and admits enforce_rule under the same 120-second cap."
  }
---
Filed from project `runlith`.

The set's first prefix yielded 16 small files; fixed reading and the cold parser were extrapolated over a very small text volume. The owner's sample fix selects it via reach within the old bounds and re-measures the saved estimate before a new refusal. The working server did not change.
