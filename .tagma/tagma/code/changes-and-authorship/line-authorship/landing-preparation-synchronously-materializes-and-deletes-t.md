---
id: 01a15134-0b9f-7e2c-809e-ec20d3c9de65
title: Landing preparation synchronously materializes and deletes the whole selected tree
ord: 54
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15136-4972-7873-a568-2f09003087d7",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15120-d727-72aa-b665-acc0f13fcc59
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/prepared/tree.ts
---
Reading of the selected working texts, materializing the mirror of the selected own texts and `.gitattributes`, deleting the mirror, the index, and the instance are moved to native async I/O at prepared. Already visited ancestors are not walked again; only the selected part of the tree is mirrored. Cleanup registers before materializing; a started write completes before deletion, including on cancel. The public prepare/submit are covered: attributes, CRLF, global clean filter, whole, merge index, peer-line preservation, and cancel after materializing with no publish and no temp-file leaks. SubmitBytes, SubmitEnds, and SubmitMerge passed 10 tests on separate checkout fixtures. A targeted bun run typecheck of the whole delivery passed on one snapshot; in the last run there are no own diagnostics, transitively dependencies met someone else's operation-claims change (35 errors in 10 files). The first shared run's own errors are fixed. Boot sweep did not change; real large-tree latency was not measured. One independent review of the whole delivery [[01a15143-2305-7aa1-bd5e-bef8070ec0a7|fs-delivery-review]] completed with no findings.
