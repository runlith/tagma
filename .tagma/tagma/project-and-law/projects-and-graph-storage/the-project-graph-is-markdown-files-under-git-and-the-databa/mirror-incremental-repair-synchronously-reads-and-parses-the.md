---
id: 01a15134-0b9f-7e2c-809e-ec1dfe91cabe
title: Mirror incremental repair synchronously reads and parses the whole arrivals set
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15121-4481-7274-ae81-9b7f29d62547",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15120-d727-72aa-b665-acc0f13fcc59
---
In `apps/tagma/server/src/graph/tree/mirror.ts:394–408` repairMirror reads with readFileSync and fully decodes every changed block file; the arrivals set's total volume isn't bounded by a page. Background `graph/serving/freshness.ts:219–269,328–418` leads to `graph/tree/freshness.ts:277–284` and drivers.repair(changed). External mass edits, checkout/merge produce a large set, while the full scan.worker doesn't serve this incremental path. Move arrivals reading/parsing and the related identity check `tree/duplicates.ts:6–10` off the shared loop, keeping transactional repair, the trash, and duplicate-identity. Start from the difference between full scan and repair; show the repair contract and a local loop measurement on a growing set. Proven here are the locus and volume growth, not actual duration. `graph/tree/projection.ts` is out of this work.
