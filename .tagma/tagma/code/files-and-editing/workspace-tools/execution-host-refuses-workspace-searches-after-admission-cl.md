---
id: 01a1986a-2b10-7e49-b126-c1e605a153f0
title: Execution host refuses workspace searches after admission closes
ord: 155
tags: ["reflection"]
fields:
  {
    "actual": "The call failed before searching: executionSpawner.spawn refused the launch as Unauthorized because the host refused the take with AdmissionClosed — this host admits no more work.",
    "command": "functions.grep({\"pattern\":\"The process died before this tool call settled\",\"output_mode\":\"content\"})",
    "expected": "Search the checkout and return matching lines."
  }
---
Filed from project `tagma`. Received by a server up since 2026-11-01T18:39:50.283Z, from 7ac4dab4f.

The reporting agent observed this on the stated search. Independently, my grep for `AdmissionClosed|admits no more work|executionSpawner\.spawn` and a glob search both failed with the same nested refusal, while graph and direct file reads continued. No host restart was attempted.