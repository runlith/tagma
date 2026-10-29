---
id: 01a15cbb-ac70-7745-a61b-842a9b3f8838
title: The CLI-agent screen in the thread and the tab terminal list come back on their own after a transient read failure, with no Retry or Read again
ord: 38
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15cb6-1a1b-7e60-8e0c-66f764444c53",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15c5c-d764-7aca-9b65-9090251c93cd
---
Found by the terminal delivery review. A `read_terminal` failure at the thread's CLI screen becomes a card with raw text and Retry, and the `replacing` branch promises to return but has no re-read. A terminal-list read failure shows `ReadingFailed` with a code, unblock and Read again, while a restored connection never resumes that read. A lost subscription at the CLI screen is detected by the "Watch again" button label.
