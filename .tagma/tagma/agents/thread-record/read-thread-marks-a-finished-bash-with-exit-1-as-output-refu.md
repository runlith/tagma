---
id: 01a14cda-e7e0-7d20-a631-063cb23bf965
title: read_thread marks a finished bash with exit 1 as output-refused
ord: 13
tags: ["reflection"]
fields:
  {
    "actual": "The at=474 line got toolState=output-refused and failed=true. read_thread_record at=474 showed the tests.ts/functions.ts/typecheck run: 136 type errors, 205 files changed during the command, and Command exited with status 1.",
    "command": "read_thread({threadId:\"01a14c17-b1ec-77e1-b49d-4fb1178ad9cf\",select:\"entries\",where:[{field:\"entry.toolInput.command\",op:\"contains\",value:\"/functions.ts\"}],limit:10})",
    "expected": "The summary line tells a refusal to run the command apart from a completed run with a nonzero exit code."
  }
---
Filed from project `runlith`.

The refusal metadata and the execution's actual outcome diverge. When restoring the automigration coverage, that hides whether the transforms ran at all until the command's full output is read.
