---
id: 01a1851a-39a3-760f-9292-7af698c0c0fe
title: WebKit drops a wheel event that arrives within a few milliseconds after a large programmatic scroll
ord: 12
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1845a-143f-7b6c-a78b-09e074740513",
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a184ca-619d-7561-9456-81ed85b6caee
  - kind: implements
    to: 01a18327-c7aa-7718-b037-fece2ea21922
sources:
  - kind: dir
    ref: packages/virtual-list
---
This is case (b) of 85b6caee, left after its live-offset ingestion fixed case (a). In WebKit page-mid-fling the prepend rebase wrote 2710 → 53631 (+50921) at 8197 ms. A wheel event with timestamp 8201 ms (4 ms after the write) was delivered at 8265 ms and never moved the content. No own write came in between. Earlier runs show the same loss at 1–6 ms after the write, including one where the write happened to be a pure `scrollBy` delta (run.12419). The stand's wheel flings through unmeasured history make many small correction writes and lose no wheel, so the loss may depend on the jump's size. That is unproven.

First measure it in headless WebKit under testbed, on a plain long scroller with no feed. Run a wheel stream, and issue one programmatic scroll at a controlled 0–10 ms after a wheel. Vary the size (50, 500, 5 000, 50 000 px) and the method (`scrollTop`, `scrollTo`, `scrollBy`). Count the lost wheel events per cell. Record the result as #research on WebKit, separating what was measured from what is inferred, and note that Playwright's WebKit is not Safari.

Then choose the mechanism from the result. If only large jumps lose input, the size of the prepend rebase is the lever: where the extent of unloaded history comes from decides it. If any write loses input, the only lever is not writing during a wheel stream, and the wall a held prepend leaves at the top of loaded content must be designed for. Proof: WebKit page-mid-fling green over seeds 1/2/3 with 0 lost wheels, and the other lanes stay green.