---
id: 01a0f25e-83b5-71e5-8f70-f807ce29b7ac
title: Anthropic continuation rejects a system message before a non-assistant wire turn
ord: 2
tags: ["reflection"]
fields:
  {
    "actual": "HTTP 400 req_011CfZeYDitVpQjxE8SrN5tY: messages.201 role system must precede assistant or end the array; the rejected attempt never started the model.",
    "command": "claude-opus-5-5 continuation in thread 01a0f219-4661-7235-b4ca-8124a31a54e0, run 01a0f258-9026-782d-97f0-57bb8d1ac737",
    "expected": "Build an Anthropic-valid chronological request for mixed-provider history and tool continuation."
  }
---
Filed from project `runlith`.