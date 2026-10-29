---
id: 01a14cce-f009-78f8-a168-bc32100916b7
title: Re-reading saved stdout requires a separate Base64 decode
ord: 26
tags: ["reflection"]
fields:
  {
    "actual": "After the first read answered “no new output”, read_command_bytes returned 3350 saved bytes in Base64. Auditing the file listing took one more command: tagma op read_command_bytes | bun with Buffer.from(..., 'base64').",
    "command": "read_command_bytes({ execution: \"b5dfecda-9564-4696-8fdc-3f87da52cc87\", incarnation: 167, stream: \"stdout\", offset: \"0\", limit: 4000 })",
    "expected": "Read the saved stdout text of a finished command with one addressed read from a position."
  }
---
Filed from project `runlith`.
