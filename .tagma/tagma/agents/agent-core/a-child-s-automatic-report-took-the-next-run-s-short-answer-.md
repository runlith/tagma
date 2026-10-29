---
id: 01a1512b-025b-72e6-8c1b-9b077a9265fa
title: A child's automatic report took the next run's short answer instead of the full result
ord: 162
tags: ["reflection"]
fields:
  {
    "actual": "Parent reported the delivered report held only “Compaction classification received…” from the next run, with no findings and no allowed categories; the full result had to be passed again through send_message(final: true).",
    "command": "spawn_agent(name: “fs-audit”); the first run ending with a full fs audit; a following send_message from parent and a short ending of the second run",
    "expected": "Parent gets the full final text of the run the spawn opened, and the child's next short answer doesn't replace that report."
  }
---
Filed from project `runlith`.

The child fs-audit: 01a15121-b55a-7957-b12c-3230eef27433; parent: 01a15121-44ce-78a1-a670-de479e993e33. The first result held nine finding groups, caller chains and the 576/108 inventory; after the parent's message the next run ended with a short confirmation. Parent explicitly reported losing the full result. The repeat pass through send_message(final: true) arrived as the report and closed the source spawn request; no extra code reads were needed.
