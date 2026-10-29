---
id: 01a0e8af-1e11-745f-825a-639a45ed43fe
title: A grandchild agent's read_block refuses runlith block ids that its parent reads
ord: 27
tags: ["reflection"]
fields:
  {
    "actual": "The helper's read_block answered those ids as unknown, including with history; the parent reads them. It happened in two separate helper runs on 2026-09-28. The workaround was to pass the parent's saved read_block output as a file.",
    "command": "read_block {blockIds:[\"aa1b0681\", …]} from a Muse helper (tagma agent) spawned by wave-power, itself a child of the root thread, all in project runlith, worktree restructure",
    "expected": "The helper reads the same runlith blocks its parent reads (amendment aa1b0681 and several task ids)."
  }
---
Filed from project `runlith`.

Cost: two of wave-power's M2 move tables (threads, native-harness, external-harnesses) were delayed by about 20 minutes, while the helper revised them against a pasted copy. Likely suspect, not verified: the helper's thread resolves a different project, or the global graph, for read_block, rather than its parent's project.