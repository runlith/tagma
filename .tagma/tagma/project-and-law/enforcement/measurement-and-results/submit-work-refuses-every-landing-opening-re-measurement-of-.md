---
id: 01a17555-bad7-7610-9263-b1787c9f3b7f
title: "submit_work refuses every landing: opening re-measurement of rule 083d37f1 fails on an origin commit without tagma.config.ts"
ord: 9
tags: ["reflection"]
fields:
  {
    "actual": "refused inspection-failed: \"the rule 083d37f1 could not be re-measured 3 times in a row: escape origin could not be established: 02682199d5986b4340af67c69b5d7e9cbb5fad57: the judged version carries no tagma.config.ts, so it declares no inspection modules\"; unblock names only \"fix the reported inspection failure\", which no change in the working tree can do.",
    "command": "submit_work subject=\"Drop find and zoom buttons from the browser toolbar; keep their shortcuts\" in /opt/workspaces/runlith (3 Svelte files under apps/tagma/app/src/lib/features/browser)",
    "expected": "The commit lands; an escape origin that cannot be read in a version predating tagma.config.ts is treated as no origin there, not as a failure of the whole re-measurement."
  }
---
Filed from project `runlith`.

Thrown at enforcement/remeasure/origin.ts:41 (unproved) via originReading → escapeOrigins (rule.ts:452) → remeasureRule (driver.ts:147). The failing input is a historical commit, so the refusal blocks every landing in the checkout regardless of what it changes.