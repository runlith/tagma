---
id: 01a15fc1-be57-7d9b-b7b9-4c8c36c72ddb
title: "read_harness_protocol crashes printing the answer: it reaches for a missing holdings"
ord: 15
tags: ["reflection"]
fields:
  {
    "actual": "The tool answered only `undefined is not an object (evaluating 'result.holdings.length')`, with no protocol state and no typed refusal.",
    "command": "read_harness_protocol({\"threadId\":\"01a15eaf-70c8-75e5-8953-8e5a86c0792f\"})",
    "expected": "A read of the thread's ACP protocol state, or a typed answer that the thread has no such protocol."
  }
---
Filed from project `runlith`.
