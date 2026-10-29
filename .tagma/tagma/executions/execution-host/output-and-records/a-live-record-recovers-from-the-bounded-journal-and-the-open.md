---
id: 01a129a8-7e55-7dff-93d9-3e6ff99c1d93
title: A live record recovers from the bounded journal and the open segment's payload
ord: 1
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a1271e-2479-7971-9b0c-4eca5084ccfe
sources:
  - kind: file
    ref: packages/execution-host/src/RecordJournal.ts
  - kind: symbol
    ref: packages/execution-host/src/RecordWriter.ts
    symbol: makeRecordWriter.reopenSegment
---
The journal keeps closed frontiers with checksums, the grid and the hold frontier; a closed payload is never re-read at recovery. Journal records apply linearly and fold against the remaining segments and grid, so the handover gap depends on the held record, not the whole output history. A journal confirmation, like payload, means a finished filesystem write; power loss is outside the guarantee. The unfinished last line was never confirmed and is cut before continuing. The open segment's frontier is its payload length, except for a stream the execution owner recorded as ended-with-error while the journal holds it open: such payload can carry bytes the carrier never confirmed, and reopen ends the stream with error at the journal frontier.
