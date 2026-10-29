---
id: 01a15cb9-b72c-78d2-87b8-ae47e621e854
title: An output stream's errored end is kept in the journal when the segment is closed and the next one never opened
ord: 35
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15cb6-19d0-7f15-bbd1-14817bc419a0",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15c3b-a640-7e5f-ad71-e79a3ee8615d
  - kind: relates
    to: 01a15c50-c83c-7f29-b063-a4c62de1558f
---
Found by the [[3ee8615d]] delivery review: on an `output` segment change the old segment closes in the journal before the new one opens. If opening refuses, `endOne(output, 'error')` tries to close the same segment twice, the journal rejects it, and the `error` end stays in memory only. After a logic change `output` resumes from the old place, and the chunk where the failure happened silently vanishes from `output`; it stays in stdout and stderr. The stream end must reach the journal in this state too.
