---
id: 01a0d85d-a259-799e-afb1-1f89d680830b
title: "The machine store is 18.5 GB and the telemetry store 7.3 GB: find what fills them, what retention keeps, and what should go"
ord: 158
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d85e-37eb-710d-bd98-2a64180cef31",
    "status": "done"
  }
---
**Measured on 2026-09-25 by profile thread 01a0d842:**
- `~/.tagma/tagma.sqlite` is 18.5 GB. Its readers each map 1 GB and hold an 8.5 MB page cache, so most reads go through `pread`, up to 10.9% of a hot reader's samples.
- The telemetry store takes 7.3 GB on disk, under the 8 GiB user setting.
- Run traces are kept whole; one held 206,725 spans.
- 5.35 M spans were dropped, 2 M of them in one 5 s window. The cause is not established.

**Do, read-only first:**
1. Measure what each table and index holds — rows and bytes — without a full `dbstat` pass over the live 18.5 GB file: sample, count per table, read from a copy if needed. Keep every command within the 90 s limit.
2. Map the largest ones to their owners and their retention rules. Where a retention exists, say whether it runs.
3. Find the cause of the span-drop burst.

Report before changing anything. A fix — retention, compaction, a trace cap — is its own task once the operator has read the numbers.

**Done when** the report names the largest tables and indexes with sizes, their owners and retention, and the drop burst's cause or what is missing to find it.