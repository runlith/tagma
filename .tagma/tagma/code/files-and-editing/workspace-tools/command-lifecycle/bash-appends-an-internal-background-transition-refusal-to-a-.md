---
id: 01a13faf-96ef-7ece-93aa-1b2fd621b098
title: bash appends an internal background-transition refusal to a successful command result
ord: 8
tags: ["reflection"]
fields:
  {
    "actual": "The command returned the wanted source text and finished with no shell error, but metadata said: \"Its wait passed and this call could not move it to the background: This installation owes nothing for 3b8e381f-b69c-4b53-86db-ee6d2a7aea28; a mode moves only while its obligation stands.; it was held here until it ended.\"",
    "command": "bash({command:\"git -C .external/effect show effect@4.0.1:packages/effect/src/Effect.ts | head -n 7785 | tail -n 140\", description:\"Read repeat options for bounded process observation\", waitMs:1000, lifeMs:10000})",
    "expected": "A finished command returns its result and exit status; if the wait expired first, a working address of the background run is returned."
  }
---
Filed from project `runlith`.
