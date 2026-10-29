---
id: 01a16545-0741-76a6-9713-f83109a56cb9
title: A rule re-measure loses a temporary cache file on rename inside one process
ord: 120
tags: ["reflection"]
fields:
  {
    "actual": "In a successful system run (1 pass, 23 assertions) a WT re-measure returned inspection-failed: ENOENT on rename .git/worktrees/absorb/tagma/measured/01a16544-8cd4-7b56-94f1-e334b5e46890.json.33027.1792700362535 → …json; stack enforcement/rules/measurements.ts:66, remeasure/rule.ts:486. The cause is not yet established; the temp-file path holds a pid and a millisecond.",
    "command": "bun test ./src/composition/testing/enforcement/absorbCheckout.stest.ts --parallel=1",
    "expected": "Parallel re-measures of one rule in one checkout keep the confirmed measurement with no temp-file loss."
  }
---
Filed from project `runlith`.
