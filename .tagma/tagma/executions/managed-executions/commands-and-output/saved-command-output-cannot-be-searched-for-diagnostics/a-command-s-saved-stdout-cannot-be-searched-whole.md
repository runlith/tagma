---
id: 01a14a25-d392-7b6f-8854-9b2b339f3afe
title: A command's saved stdout cannot be searched whole
ord: 3
tags: ["reflection"]
fields:
  {
    "actual": "After 9m39s the output window held only the end of stderr warnings, without the four runtime diagnostics and the summary. read_command_bytes confirmed a separate 4952-byte stdout but handed it over as base64; text/stream search is still absent.",
    "command": "read_output({execution:\"5cd9a8f9-277a-4d34-a03b-b344f5c169ad\",incarnation:167,wait:600,tail:120})",
    "expected": "See the full suite's runtime failure summary as a separate text stdout, even when stderr holds long compiler warnings."
  }
---
Filed from another project.
