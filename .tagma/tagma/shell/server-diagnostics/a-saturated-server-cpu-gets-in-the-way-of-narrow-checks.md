---
id: 01a13fbb-68e2-7b63-b559-c6ffde3c8217
title: A saturated server CPU gets in the way of narrow checks
ord: 10
tags: ["reflection"]
fields:
  {
    "actual": "Machine saturated; Tagma takes 62.8% of machine CPU, the main serve 54.0% (12 cores); Tagma RSS 7.39 GB. A narrow package check exhausted 3 minutes with no diagnostics, serial tests started ending in 10 s timeouts.",
    "command": "read_machine_load with limit 5.",
    "expected": "One serial test and a package check with --threads=1 finish within acting limits with no Tagma overhead to speak of."
  }
---
Filed from project `runlith`.

The measurement was taken after my own commands finished; Tagma's causal share of the timeout is not proven. graphTools.itest took 25.34 s and 111.09 s wall on two back-to-back runs; the second gave two 10 s timeouts and 14.261 s CPU. graphQueuePages.itest with a changed fixture took 53.90 s wall; three cases hit the 10 s mark. Limits were not raised.
