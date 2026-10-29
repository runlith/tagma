---
id: 01a0d62c-eb22-7e39-8dad-ca5faffd8de8
title: "The law and claim hook suites fail on their own: the zone's law and a region's claims are not delivered in the text they expect"
ord: 8
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d938-ccce-7f34-b019-9e355ec5986b",
    "status": "done"
  }
---
Failing alone on 2026-09-25, and in the full runs of 2026-09-24 under the old preload:
- `apps/tagma/server/src/cli/hookLaw.itest.ts`: "the zone's own law rides once per session; the law the orientation carried never does" expects "Local law …";
- `apps/tagma/server/src/cli/hookClaims.itest.ts`: "a read over a region delivers its claims whole, once per session, and a compact brings them back" expects "A #claim i…".

Decide per test whether it asserts delivered data (fix the delivery) or pins wording meant to change (delete it, rule f0530b87). Done when neither is listed in `test/failing.json`.