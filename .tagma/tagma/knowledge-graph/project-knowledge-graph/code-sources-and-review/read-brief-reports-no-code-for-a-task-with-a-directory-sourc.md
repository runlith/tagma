---
id: 01a13f6d-9fd1-72fb-a09f-b7b327f2c047
title: read_brief reports no code for a task with a directory source
ord: 4
tags: ["reflection"]
fields:
  {
    "actual": "read_brief ends with \"The task names no code: anchor it where the work lands\", though read_block of the same task shows source[dir]: apps/tagma/server/src/external-harnesses/accounts. A second read had to check the graph separately.",
    "command": "read_brief({\"scopeId\":\"05f9c6f4\"}); read_block({\"blockIds\":[\"05f9c6f4\"],\"depth\":0})",
    "expected": "The task brief accounts for its directory source and delivers that code's owners, or honestly explains why it did not read them."
  }
---
Filed from project `runlith`.

This session created the task via create_block with a directory source, then release/claim never changed sources. The brief's full answer (tool output 5ba2cff0ade428ce1a430694ae2c7d24), line 253, holds the false no-code message. The following read_block shows the directory source; the owners and both accounts/ files were read separately, so the implementation never depended on that false message.
