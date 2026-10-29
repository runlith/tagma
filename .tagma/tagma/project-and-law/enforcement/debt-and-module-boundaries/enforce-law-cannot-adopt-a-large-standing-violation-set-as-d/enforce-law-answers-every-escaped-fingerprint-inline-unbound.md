---
id: 01a13b77-5e11-7941-9cf3-a491eb261560
title: "enforce_law answers every escaped fingerprint inline, unbounded: ~1.6 MB of output for one rule"
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "The notice carried every escaped fingerprint (~1 MB for d270a238, ~330 KB and ~270 KB for two siblings); previews were truncated but still pushed tens of thousands of tokens into the caller's context.",
    "command": "enforce_law {blockId: \"d270a238\", strictness: \"gate\", inspection: runlith-law effect-style test-runner} with 5689 standing violations (background: true)",
    "expected": "A bounded answer: counts by form/path and a page of fingerprints with a cursor, the full list readable on demand."
  }
---
Filed from project `runlith`.