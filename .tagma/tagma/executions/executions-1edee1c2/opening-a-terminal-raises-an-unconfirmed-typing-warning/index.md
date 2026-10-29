---
id: 01a130d0-e17e-7768-97f0-86673141aede
title: Opening a terminal raises an unconfirmed-typing warning
ord: 7
tags: ["reflection"]
fields:
  {
    "actual": "The screenshot shows 'typing whose landing could not be confirmed was not repeated'. The operator reported opening a terminal; the event was not reproduced on its own.",
    "command": "Opening a terminal in the Tagma interface; the operator attached a screenshot of the red banner.",
    "expected": "Opening a terminal with no typing reports no lost user input."
  }
---
Filed from project `runlith`.

The banner's source is `apps/tagma/app/src/lib/features/executions/terminal/Input.ts`: `recover()` and `release()` report LOST_ON_LANE on unconfirmed acts. `ingest()` sends service focus reports as `raw`, and those branches do not distinguish them from user typing. This is a possible path to the warning with no typing, not the established cause of this case; the event journal was not read.
