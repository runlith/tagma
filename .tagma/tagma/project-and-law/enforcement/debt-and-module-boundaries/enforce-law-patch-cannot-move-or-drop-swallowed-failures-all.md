---
id: 01a13d55-ba46-7a15-be0c-7ef4b5b96da3
title: enforce_law patch cannot move or drop swallowed-failures allowances when one symbol holds several sites
ord: 21
tags: ["reflection"]
fields:
  {
    "actual": "inspection-failed both ways: drop \"matches several entries\", put \"names … twice\". The only way out was resubmitting the whole 76 KB, 293-entry document through `tagma op enforce_law --json \"$(cat file)\"`, since the typed door takes the inspection inline. 13 keys in that list already hold several sites, so any symbol rename over them hits this.",
    "command": "enforce_law ea465bed base 01f9c07b5f4c, inspection.patch swallowed-failures allow: drop {executionSpawner.ts, spawn, ignore}; put two entries {executionSpawner.ts, executionSpawner.spawn, ignore} with sites d744c011 and 20c69754",
    "expected": "The patch carries the two release allowances to the renamed symbol and drops the three under the old one: the list legitimately holds several sites per path+symbol+form, so the patch key should include the site."
  }
---
Filed from project `runlith`.