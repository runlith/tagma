---
id: 01a17e2c-07f0-7648-b05d-33052b512a36
title: A pipes command's ended output lands as output.log in its record when output ends — before the Completed verdict, so the named path already stands
ord: 13
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a17e18-53d1-7506-a96d-58eaf0914a86
  - kind: relates
    to: 01a13568-7913-73f0-96f8-b83c45c2e267
  - kind: relates
    to: 01a15c50-c83c-7f29-b063-a4c62de1558f
sources:
  - kind: symbol
    ref: packages/execution-host/src/ExecutionRecord.ts
    symbol: makeSegmentRecord.keepOutput
  - kind: symbol
    ref: packages/execution-host/src/ExecutionRecord.ts
    symbol: makeSegmentRecord.settleOutput
---
The file is written when both sources end with EOF, and before `output` is declared ended: after the sources' end nothing more lands in `output`, while the Completed verdict is still unmade — it awaits the last source's settle. The `output` end is declared only after the file is written, otherwise a summary between them would read as "output ended but there is no file", and the answer would say there is no file just as it is about to stand. So the path the summary names after Completed already stands on disk, and the agent's answer may name it. Sealing on the way to the shelf never fits this: the shelf waits for readers to leave, while `bash` reads stdout and stderr right up to the answer, so the file would appear only after the answer.

Both sources end in parallel, and the second, seeing `output` already ending, awaits the first one's file write: otherwise its settle could yield Completed ahead of the file. The summary carries the path only after the temp file's rename. The copy goes under the record carrier's bounded time like other stream-end acts: it is optional, and an unanswering carrier must never hold Completed and resource return. A failure or an expired deadline leaves the record fileless and the summary pathless, while record and read stay untouched. An error-ended `output` and an empty `output` yield no file.

The file copies the `output` window, never replaces its segments: a replacement would change sealed-record reading and verification (segment checksums, recovery) for one stream. The copy sits in the record directory, so the shelf counts it in its share and deletes it with the record. On reopen of a record with an ended non-empty `output` the new logic takes the standing file, and if there is none — the old logic was cut between the stream end in the journal and the rename — rebuilds it from the segments. The summary of a record the logic does not hold reads the path from disk by the record's seal and the file's presence.
