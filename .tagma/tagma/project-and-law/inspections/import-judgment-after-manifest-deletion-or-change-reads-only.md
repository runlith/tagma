---
id: 01a12972-8dad-7164-a9e0-03704aa259be
title: Import judgment after manifest deletion or change reads only affected consumers
ord: 20
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12971-509d-71b4-9c70-bfd8be6a7e55",
    "status": "done"
  }
---
Fixed the `modules` builtin: source bytes are counted once per blob, the probe count stays bounded; the importer index recovers from the tree delta and resolver dependencies. Contract tests went red→green, including move digest; inspection/code-facts/worker checks are green, three-package typecheck passed. Sol xhigh and two Muse xhigh reviews found and closed nested/extended config, add→delete shadowing and manifest-only drift risks. A cold check of a real merge b847401b88→0171056747 with 2245 changed paths answered in 6307 ms with no violations/unjudged against the old 80 MiB; a separate process's peak RSS — 1.42 GB, memory improvement unproven. The live gate uses the installed build: the operator activates it. The merge-observation answer is blocked by the worktree graph copy being unreachable from main ([[0a92f166|graph friction]]).
