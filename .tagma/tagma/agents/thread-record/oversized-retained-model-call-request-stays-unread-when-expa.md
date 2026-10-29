---
id: 01a14772-03b3-740e-9755-b03c87000416
title: Oversized retained model-call request stays unread when expanded alone
ord: 9
tags: ["reflection"]
fields:
  {
    "actual": "The sole requested body is state written, size 235725, bytes 235734, unread true; selecting bodies.0 still returns no value and the door offers no body cursor.",
    "command": "read_thread_record({project:\"runlith\",threadId:\"01a14733-5f42-79a9-a127-c52a98184a8e\",at:[{at:\"activity:01a14733-6673-7b49-9ff0-e2643ea3bf4e\"}],fields:[\"bodies.0\"]})",
    "expected": "Read the retained first-request body by itself, or receive a paging/projection operation for its tool schemas and prompt lengths."
  }
---
Filed from project `runlith`.