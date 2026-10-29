---
id: 01a13085-723b-7884-87f0-bde999257789
title: read_thread_record does not open an oversized toolOutput even in a dedicated call
ord: 5
tags: ["reflection"]
fields:
  {
    "actual": "The answer: '@41 — This address exceeds the answer envelope; read it in a call of its own.', though the call already held only #41. Checking provenance took separately reading entry.toolDisplay.reference, read_output, two read_command_bytes pages, and parsing base64; that command's stdout is 73,266 bytes. The recovery line gives no actionable next step.",
    "command": "read_thread_record {\"threadId\":\"01a1307d-b47e-750b-bc32-f9a9cc847191\",\"at\":[{\"at\":41}],\"fields\":[\"entry.toolInput\",\"entry.toolOutput\"]}",
    "expected": "One addressed entry either reads whole, or the answer gives the address of a separate retained body or a continuation for it."
  }
---
Filed from project `runlith`.
