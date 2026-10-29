---
id: 01a16e17-88e4-7e2d-912d-67aab02ac505
title: "Dissect the remaining eight HTTP files: keep catalog, checkout and worktree boundaries, remove duplicates"
ord: 17
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16dee-9d53-71ef-9314-aa7f4f194d3b",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16b01-cb85-7e31-9936-47664dbd9a84
---
Eight HTTP files dissected with 89.9 s CPU base cost and 21 scenarios. Four narrowed: checkoutActs 4→2, admission 6→1, commitSteps 3→1; in reflectWorktree duplicates of ordinary reflections operations removed, both unique worktree checks kept. The other four files kept unchanged; 12 scenarios remain in total, all eight files written to git. Changed files pass seeds 1–3 separately with no skips; the sum of cold seed-1 measurements 62.8 s CPU includes repeated world loads and is not comparable to the shared base run. The comparable shared total stays with the lead's quiet run. Server typecheck clean; the shared call stopped on two foreign errors in BuiltArtifact.inputs in execution-host/hostExit.itest.ts. Line-by-line decisions and measurements recorded in x10/x-http-rest.tsv.
