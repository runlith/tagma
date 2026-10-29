---
id: 01a15ddd-46db-7428-a483-128df971175d
title: read_block_diff answers "1 of undefined" with no diffs and no read boundary
ord: 7
tags: ["reflection"]
fields:
  {
    "actual": "The answer holds only the block header and the \"1 of undefined\" line; no diffs, no total, no continuation.",
    "command": "read_block_diff({\"blockId\":\"78e89b66\",\"since\":\"2026-10-21T09:26:33.894Z\"})",
    "expected": "Return the block's diffs after the given time, or an explicit no-change result with the coverage boundary."
  }
---
Filed from project `runlith`.

During a read-only review of the registry increment, the same result was independently obtained for block 7d9e23cc with the same since. That is neither a refusal nor proof of no changes: the published increment adds new identities and lead. Ordinary read_block covered the needed current sections.
