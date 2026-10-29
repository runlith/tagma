---
id: 01a13d7d-df8d-7f88-a56f-419927ab6564
title: read_brief does not see the task's directory sources
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "The brief ends with \"The task names no code: anchor it where the work lands\", while the read_block right after shows all three source[dir]. read_owners and the three modules' zones had to be read separately.",
    "command": "read_brief({scopeId:\"a518f9e1\"}) after anchor_block for packages/execution-host/src/holder, holder-client, and posix",
    "expected": "The brief accounts for the task's three sources and delivers their owners, or plainly explains which directory sources it does not support."
  }
---
Filed from project `runlith`.

Brief output: ~/.tagma-dev/tool-outputs/01a13d2f-a3e1-7eb6-b786-be39dc244afb/a43edb1fe7bbc4639f2e0e09397458dc.txt:225. Owners resolve fine: holder → ec75f4da, holder-client → 4a42e855, posix → 921755ee. All three anchor_block calls answered successfully before the brief.
