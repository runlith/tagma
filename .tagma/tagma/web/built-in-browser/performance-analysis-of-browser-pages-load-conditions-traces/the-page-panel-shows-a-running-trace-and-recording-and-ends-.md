---
id: 01a185ac-ca1d-7f60-a98a-858248dbefb7
title: The page panel shows a running trace and recording and ends each with one act
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a185ad-5d95-781b-ac4b-c7ffd9e300d0",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a184dc-4fbe-7b01-a2d5-4fac647a38eb
---
The parent spec promises that a human sharing the page sees it is slowed, traced or recorded, with one act that ends each. Conditions already show in `PageNotices.svelte` with Reset; a running trace and a running recording do not. The page's live state carries both — who started each and since when — and the panel shows them beside the conditions line in the same grammar, each with the act that stops it through the existing `trace_page` and `record_page` stops; a stopped recording's video stays in the agent's feed as today. The phone page view shows the same state where it shows conditions.

Acceptance: an engine scenario starts a trace and a recording and reads both in the page's live state, then stops each through the operator's door and reads them gone; the panel component shows and stops them against the app's test doubles.