---
id: 01a174c2-aedb-796f-a3d1-a7539017d51b
title: Thread references in a block body are recognized and open the same way as in the feed
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a174c0-b5e1-7b5a-9272-9d93c0a73486",
    "status": "done"
  }
---
In the body of the [[24e6b6b0|report block]] the editor recognized only block refs. Thread-ref format parsing and rendering are now shared with the feed: the label keeps, the name updates, opening goes through Opening with the owning projectId. An arriving name no longer rebuilds the Editor; refresh updates nodeviews without writing to the document. The report scenario first failed with 0 links instead of 2, then the check exposed the Editor rebuild; the total is 24/24 targeted app tests, a new Body test on seeds 1/2/3, 13/13 editor tests, editor typecheck, and all 19 rules clean. An independent review has no findings. The shared app typecheck during verification gave 181 errors of a parallel app-law migration, with no diagnostics in the delivery's files; no live run was performed.
