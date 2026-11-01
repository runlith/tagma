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

The reporting agent observed this on the stated search. Independently, my grep for `AdmissionClosed|admits no more work|executionSpawner\.spawn` and a glob search both failed with the same nested refusal, while graph and direct file reads continued. `read_terminals` reported that the server adopted an existing host but could not take custody because admission was closed.

Host trace `587b0c1e4c3ccd8a01899d2bdaa6c976` records a recovery-role shutdown of incarnation 167 beginning at 18:28:46 UTC; it does not record the typed shutdown outcome. The host registration names logic born at 18:29:35, and later TakeHost spans for incarnation 167 record AdmissionClosed. Current code persists `stopping` before the shutdown sweep and seeds admission from the persisted phase when the holder's generation is reused. Whether that shutdown left the current phase, and whether this explains an earlier hung call, remain unproved. No host restart was attempted.