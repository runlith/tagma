---
id: 01a17e18-53d1-7506-a96d-58eaf0914a86
title: A finished pipes command leaves its output as a file in its record, and answers to the agent name that file
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17e19-3481-72e0-96fa-5f2bb2ccab64",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a17e18-334d-79d8-9477-6b9e908f3f65
---
Items 1–3 of the spec in one change: the host writes `output.log` at seal time and names it in the summary; the executions protocol carries the path and range; the `bash` answer, the end notification and `read_output` name the file when they don't carry the full output themselves; the `bash` and `read_output` descriptions tell the agent not to divert output.
