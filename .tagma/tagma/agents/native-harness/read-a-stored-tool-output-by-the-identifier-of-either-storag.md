---
id: 01a11979-f030-7ce7-b52f-82eef2ef425e
title: Read a stored tool output by the identifier of either storage shape
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a11979-16fc-76b4-988c-8552009fb0ef",
    "status": "done"
  }
---
Fix stored-output lookup in ThreadToolOutputStore: a JSON identifier from persisted-output must read its file's bytes like a text-output identifier. Verify through the public read_tool_output on a project result; keep the refusal for a missing identifier.
