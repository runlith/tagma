---
id: 01a0e85c-e75c-7a4a-a101-1f80319a5f70
title: Shared-tree shell observation footers defeat bounded check output and add minutes after the command
ord: 22
tags: ["reflection"]
fields:
  {
    "actual": "Recent own-path checks printed 581, 573, and 187 shared moved paths in automatic footers, despite filtering stdout to 50 lines. The names inspection reported 14805 ms but its call ended at 4m46s; the typecheck call ended at 3m31s after the 2m command rule because attribution reading is not bounded. These observations are explicitly attributed to nobody and unrelated to this check's writes.",
    "command": "bash: bun run typecheck 2>&1 | rg '<owned paths>' | head -50; timeout 60000",
    "expected": "A bounded own-path diagnostic reading, with shared-tree observations summarized and pageable rather than printed wholesale; short checks should not block for minutes after completing."
  }
---
Filed from project `runlith`.

Owning layer is Tagma's command completion/change-observation reporting, not this projects module or its test commands. The shared restructure checkout has many writers; repeated footers add thousands of unrelated path tokens per read-only check, so shell-side filtering cannot solve the producer cost.