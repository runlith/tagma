---
id: 01a120ca-618a-7432-a410-4fc6b133508a
title: Fix the hanging terminal Stop during launch
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14dd1-43cd-7723-af0a-5cf815955c6a",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a11e8d-ee79-7708-8065-6ea38180548b
  - kind: implements
    to: 01a11c9a-6edb-7ed8-b517-60b0a621fbb3
---
While clearing the scripted parity world, stopping a terminal thread during launch intermittently left the driven fiber waiting; it reproduced without terminal take-up too. The owner is SessionDriver/SessionLauncher in external-harnesses, the exact cause not yet found. In a5fe025f97 the harness bounds release to three seconds and finishes processes from past scenarios, but the production race is not fixed. Find and fix the stop order at its owner, and prove it with a public Stop on a controlled launch boundary with no timeout as recovery. Evidence: the final impl-acp-questions report of 2026-10-09 13:04 UTC; diagnostics at /var/folders/87/cmcr9wbs5yqcbthnzgqp7lh80000gn/T/parity-proof/dg2.txt. Green q1–q3 do not prove this race.

Outcome (`a922f28f23`): the cause was an `interrupt` arriving before the session row, which answered `not-running` while launch went on; only a repeat Stop on the next lease tick (5 s), or no tick no Stop wait, ended it — so Stop waited forever. Now `interrupt` marks the run (`OpenRuns.halt`) and ends it as `aborted` itself when no process exists yet; `launch` checks the mark after recording the intention, and session open refuses a run whose turn is already taken. The probe's second finding: Stop over words without a read receipt took the run down as `withdrawn` (first `lapsed`, then the end) — now the end is written first. Both fixes are proven red→green in `terminalDelivery.stest.ts`. Not proven: the exact cause of the historic hang in parity-world cleanup (diagnostics did not survive); the reproduced mechanism matches the description.
