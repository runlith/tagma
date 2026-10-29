---
id: 01a16e84-c361-71ee-b5a8-393a44dc757a
title: Move the hook-report decision from the CLI world to unit, leaving one real boundary
ord: 34
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16dee-5b26-7878-822b-21458858cf1f",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16b01-cb85-7e31-9936-47664dbd9a84
---
Dissect apps/tagma/server/src/composition/testing/cli/hookReport.itest.ts using the CPU probe from /var/folders/87/cmcr9wbs5yqcbthnzgqp7lh80000gn/T/prof; base after narrowing 4c5e991e1c — 19.3 s CPU versus 24.1 before. Event stitching, report data selection and refusals checked through the owner's public operation over the existing port; the itest keeps one CLI→server scenario. Affected files pass seeds 1–3 and bun run typecheck; outcomes and covering tests recorded in x10/x-packages.tsv. Start no new work after 17:10Z; bring what started to the end and land it with no hard stop and no rollback. Final sent with held paths = 0; the quiet measurement starts after every final.
