---
id: 01a1851a-1c03-7a79-94d7-f2cacbf63b6f
title: testbed replaces a split --seed argument with a random seed
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "testbed appended a random --seed=634556712 after the explicit split --seed 1; Bun and the run report used 634556712.",
    "command": "E2E_LANES=webkit bun run test:e2e --test-name-pattern 'page-mid-fling' --randomize --seed 1",
    "expected": "Forward the explicit seed 1 unchanged and report seed 1 for the run."
  }
---
Filed from project `tagma`.

Measured in run.47651.1793234334447. packages/testbed/src/cli.ts accepts --seed plus its next value in e2e argument parsing, but random-seed selection at lines 195–204 reads only a --seed= prefix, so it overwrites the accepted split form. The direct workaround is --seed=1.