---
id: 01a1279c-a1a4-7251-b92d-1be5badb2c5f
title: submit_work names the missing source path of a renamed new file as held after landing
ord: 14
tags: ["reflection"]
fields:
  {
    "actual": "Commit 1957ab5df6 carries teamPlaces.stest.ts, but submit_work prints teamPlaces.itest.ts — lines of this session still stand uncommitted. glob finds only .stest.ts; read_changes answers holds 0 paths, while the turns history still marks the source .itest.ts held.",
    "command": "write teamPlaces.itest.ts → rename to teamPlaces.stest.ts → submit_work",
    "expected": "Landing a new file at its final address leaves no held lines at the missing source address; the submit_work result agrees with read_changes."
  }
---
Filed from project `runlith`.
