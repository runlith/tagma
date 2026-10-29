---
id: 01a14c76-a41b-7f93-9193-6f8d81e94664
title: Edit reported a successful replacement, but one of the identical calls stayed unchanged
ord: 12
tags: ["reflection"]
fields:
  {
    "actual": "Edit answered \"Edit applied successfully\". A later read found the new call in the resize test and the old call in the recorded fixture; one more edit with context was needed. The same parallel block carried an edit of the pipes call; read_changes shows my own lines and old overlap observations but does not prove why they diverged.",
    "command": "edit({path:\"/opt/workspaces/runlith/packages/execution-host/src/RecordReaders.itest.ts\",oldString:\"  const record = yield* SegmentRecord.open(fs, path, root, ref, 'pty', profile.execution, { grid: { rows: 24, columns: 80 } });\",newString:\"  const record = yield* makeSegmentRecord({ mode: 'create', records: root, ref, transport: 'pty', limits: profile.execution, grid: { rows: 24, columns: 80 } });\"})",
    "expected": "On two matches of the exact substring, edit refuses as ambiguous; an independent edit of a neighbouring call does not lose the replacement already applied."
  }
---
Filed from project `runlith`.

Before the read call, lines 52 and 290 showed identical text at different indents; oldString started with two spaces and excluded the line boundary. The cause is not established: this is an observation of the result disagreeing with the later text, not a conclusion that a specific mechanism lost the write.
