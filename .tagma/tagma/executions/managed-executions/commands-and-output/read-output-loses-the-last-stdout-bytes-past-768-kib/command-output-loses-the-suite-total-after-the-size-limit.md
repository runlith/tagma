---
id: 01a14778-acfe-7f31-a8f2-aebdaf0fba75
title: Command output loses the suite total after the size limit
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "exit 1 came back, but stdout breaks off mid-line before the true end. read_command_bytes shows 830362 kept bytes; the 822000..830362 window holds the missing total: 4023 tests, 522 suites, 3 issues. Six extra calls were needed; the failed tests' names are still unavailable as text.",
    "command": "read_output({execution:\"1938d1b6-d7e0-4394-9b25-7d7f024f754c\",incarnation:167,wait:60,tail:45})",
    "expected": "The last 45 lines hold the true test total, and errors are available as text without decoding the whole stream."
  }
---
Filed from another project.
