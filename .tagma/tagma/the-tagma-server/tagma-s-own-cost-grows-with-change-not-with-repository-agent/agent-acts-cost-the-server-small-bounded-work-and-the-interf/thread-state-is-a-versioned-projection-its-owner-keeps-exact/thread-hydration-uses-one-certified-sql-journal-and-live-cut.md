---
id: 01a196bd-408d-7842-9883-b514220d2c3d
title: Thread hydration uses one certified SQL, journal and live cut
ord: 2
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: implements
    to: 01a18cde-5f93-73e8-aa31-64572afe6fec
sources:
  - kind: file
    ref: packages/agent/src/thread/run/ThreadSnapshots.ts
---
Publish a certified journal prefix and its entry facts under a stable source identity, retain that generation through actual reader/worker completion, and invalidate it through the original-store restore boundary. Hydration subscribes before reading and takes metadata, runs, inbox, newest page, journal/open-call facts and owner revisions from one SQL/source cut without a writer lease, then applies later buffered changes. Preserve Residence → live atCut → aggregate readCut, exact active-run identity and live incarnation/sequence; a successor run cannot be spliced into older stored calls. The list cursor and raw initialization share that physical reader view. The existing rollout cursor remains the file-to-SQL consumed prefix, not publication certification. The cut retains or rejects exact future prefix-read identities; open-entry text cannot leave residency until its stream tail is durable.