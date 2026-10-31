---
id: 01a1942e-f357-7156-8927-5efbfe6328e6
title: Choose reflection storage before its first durable write
ord: 10
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a1941f-f2bb-77f3-9717-654e6b8cdc4b
---
file_reflection has no storage selector, so an observation containing private context can only be moved to stealth after creation, when its first team version may already be committed. Expose the existing storage choice at creation and pass it atomically to the graph producer, preserving the current default and storage policy. Prove the public operation creates a stealth reflection without an intermediate team projection; history cleanup is outside this task.