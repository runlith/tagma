---
id: 01a1552c-20c3-7f7e-82fb-87ca8261e893
title: Split TimelineFold by subjects
ord: 6
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a15505-e84f-704a-8ac7-db7516b0175d
sources:
  - kind: file
    ref: packages/chat-ui/src/TimelineFold.ts
---
`packages/chat-ui/src/TimelineFold.ts` passed 650 lines (668) after step folding started depending on the running turn ([[16b0175d]]). The file mixes several subjects: an incremental segment table over the feed input, the live-run tail (appendix, host rail, retry), newest-segment tracking, and row finalization (days, gaps). Splitting is this task's work: start with the live-run tail as its own owner with an explicit contract to the table. Proof is files by subject under the limit, the debt gone, the kit and bench tests passing.
