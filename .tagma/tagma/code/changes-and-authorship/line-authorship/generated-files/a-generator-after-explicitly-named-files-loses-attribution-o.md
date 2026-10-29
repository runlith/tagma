---
id: 01a14c1b-9da7-7d22-abb8-7ba8330b0b11
title: A generator after explicitly named files loses attribution of its whole result to foreign parallel commands
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "The command listed 64 execution-host files changed, but the change record reported 0 attributed, 64 overlap and offers submit_work paths+whole for these files; independent sessions worked nearby.",
    "command": "bash({command:\"bun ~/.tagma-dev/scratch/01a14c17-b1ed-7b23-864a-44198f63889/functions.mjs\",description:\"Migrate remaining standalone generator functions across host\",waitMs:90000})",
    "expected": "Generator changes in packages/execution-host belong to this session; foreign commands on disjoint paths never demand a whole-file landing."
  }
---
Filed from project `runlith`.
