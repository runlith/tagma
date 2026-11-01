---
id: 01a19704-fd9f-7341-b21d-61a67af46459
title: Derive commit outputs over the inputs the commit carries
ord: 8
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19700-4d42-75f7-bb90-76d0f2013e4f",
    "status": "in_work"
  }
---
Run declared derivations and built-in lock-only generators in the commit tree when their inputs or output change. Preserve working outputs derived from all working inputs, release the landing session's ownership of their residue, and report failed derivations with omitted input holders. Prove the shared-manifest incident and generic derivation through native submit_work; update the program-written-file contract.