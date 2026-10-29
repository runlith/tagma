---
id: 01a14740-0451-79f3-a180-9db636092676
title: read_thread_record leaves a large request forever unread with no range or body-field reading
ord: 12
tags: ["reflection"]
fields:
  {
    "actual": "The single request (size 1201949, stored bytes 64613) stays unread:true even in a dedicated call; fields projects only metadata, outputFrom exists only for tool output. Diagnosing the provider requires finding the file store through the sources.",
    "command": "read_thread_record({threadId:\"01a14730-3cf9-75f0-ac7e-30f4e603a7ec\",at:[{at:\"activity:01a1473b-09f6-7cd4-83eb-fbe3a3414ff6\"}],fields:[\"bodies.0\"]})",
    "expected": "Read the saved request's max_tokens, thinking, and output_config without the whole 1.2 MB history — via a body projection or byte-range."
  }
---
Filed from project `runlith`.
