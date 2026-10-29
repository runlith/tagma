---
id: 01a14f43-abe5-717c-8867-7b425c396d64
title: "An old worktree does not open the graph: verifiedAt is rejected before the conversion steps"
ord: 17
tags: ["reflection"]
fields:
  {
    "actual": "BlockTreeUnreadable notice at ~/.tagma-dev/<project>/trees/<branch>-550ce190f930ef1/…/120aab89/487f1b97/index.md: frontmatter-shape: Expected no excess property at [\"verifiedAt\"]; Details: graph-pool, repair the graph file or layout, then retry.",
    "command": "UI: opening an old worktree of another project",
    "expected": "When an old tree is addressed, Tagma brings the stored graph files to the current form before strict reading, or tells how to perform that conversion."
  }
---
Filed from project `runlith`.

The failure is shown in two of the operator's screenshots. The file was read: the top-level verifiedAt and sources[].verifiedAt both equal 2026-08-20T02:25:07.341Z, with sources[].fingerprint and the claim tag present. The tree's git status --short is empty; the last commit touching the file is c9861e11 from 2026-09-28. Tagma commit e92d6e6162 from 2026-10-02 removed these fields from the blockFile.ts schema. In the current apps/tagma/server/src/graph/tree/blockFile.ts:84 onExcessProperty: error is on; serving/open.ts:161–172 scans the tree and builds the mirror before advanceTree (open.ts:259–274), and serving/advance.ts:41–42 also reads files before running the steps. claimsLeave already works over mirror lines and cannot remove the read refusal of the old file form. serving/refusal.ts:13–15 turns the failure into a generic offer to fix the file by hand. Code and file reading established the cause; no new graph-opening call was made, no files or code were changed.
