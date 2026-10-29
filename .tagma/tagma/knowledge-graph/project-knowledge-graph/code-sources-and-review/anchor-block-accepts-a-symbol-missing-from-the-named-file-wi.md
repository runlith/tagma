---
id: 01a15146-226d-74ce-a96d-6c0b47fd0ae6
title: anchor_block accepts a symbol missing from the named file, with no refusal and no warning
ord: 7
tags: ["reflection"]
fields:
  {
    "actual": "An answer of \"source[symbol]: …#shadowGit\" as success; only the agent itself noticed the typo, by reading the file; the fix cost two extra calls (unanchor_block + anchor_block).",
    "command": "anchor_block {blockId: \"f0aad626\", ref: \"apps/tagma/server/src/graph/tree/shadow.ts\", kind: \"symbol\", symbol: \"shadowGit\"}",
    "expected": "A refusal or at least a warning in the answer: there is no shadowGit declaration in shadow.ts (there are shadowAt, ShadowGit)."
  }
---
Filed from project `runlith`.
